const prisma = require("../services/prisma");

// GET /api/dashboard - Get user's dashboard summary
const getDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all splits where this user owes money (and hasn't paid)
    const youOweSplits = await prisma.split.findMany({
      where: {
        userId,
        paid: false,
        expense: {
          paidById: { not: userId }, // Someone else paid
        },
      },
      include: {
        expense: {
          include: {
            paidBy: { select: { id: true, name: true, email: true } },
            group: { select: { id: true, name: true, currency: true } },
          },
        },
      },
    });

    // Get all splits where others owe this user (and haven't paid)
    const owedToYouSplits = await prisma.split.findMany({
      where: {
        paid: false,
        userId: { not: userId },
        expense: { paidById: userId },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        expense: {
          include: {
            group: { select: { id: true, name: true, currency: true } },
          },
        },
      },
    });

    // Calculate totals
    const totalYouOwe = youOweSplits.reduce((sum, s) => sum + s.amount, 0);
    const totalOwedToYou = owedToYouSplits.reduce((sum, s) => sum + s.amount, 0);

    // Recent expenses across all groups user belongs to
    const recentExpenses = await prisma.expense.findMany({
      where: {
        group: {
          members: { some: { userId } },
        },
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, currency: true } },
        splits: {
          where: { userId },
          select: { amount: true, paid: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Group-level balances
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: {
          include: { user: { select: { id: true, name: true } } },
        },
        expenses: {
          include: {
            splits: { where: { userId } },
          },
        },
      },
    });

    const groupBalances = groups.map((group) => {
      let balance = 0;
      group.expenses.forEach((expense) => {
        if (expense.paidById === userId) {
          // User paid — add what others owe
          balance += expense.amount;
          expense.splits.forEach((split) => {
            if (!split.paid) balance += 0; // already counted
          });
        }
        expense.splits.forEach((split) => {
          if (!split.paid) {
            balance -= split.amount; // User owes this
          }
        });
      });

      return { groupId: group.id, groupName: group.name, balance };
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalYouOwe: parseFloat(totalYouOwe.toFixed(2)),
          totalOwedToYou: parseFloat(totalOwedToYou.toFixed(2)),
          netBalance: parseFloat((totalOwedToYou - totalYouOwe).toFixed(2)),
        },
        youOweSplits: youOweSplits.slice(0, 5),
        owedToYouSplits: owedToYouSplits.slice(0, 5),
        recentExpenses,
        groupBalances,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ success: false, message: "Failed to load dashboard." });
  }
};

// GET /api/dashboard/insights - Weekly spending & category breakdown
const getInsights = async (req, res) => {
  try {
    const userId = req.user.id;

    // Last 4 weeks
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const expenses = await prisma.expense.findMany({
      where: {
        paidById: userId,
        createdAt: { gte: fourWeeksAgo },
      },
      select: {
        amount: true,
        category: true,
        createdAt: true,
        title: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Weekly breakdown (last 4 weeks)
    const weeklyData = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - i * 7 - 6);
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      weekEnd.setHours(23, 59, 59, 999);

      const weekExpenses = expenses.filter(
        (e) => new Date(e.createdAt) >= weekStart && new Date(e.createdAt) <= weekEnd
      );

      const total = weekExpenses.reduce((sum, e) => sum + e.amount, 0);
      weeklyData.push({
        week: `Week ${4 - i}`,
        total: parseFloat(total.toFixed(2)),
        startDate: weekStart.toISOString().split("T")[0],
      });
    }

    // Category breakdown
    const categoryMap = {};
    expenses.forEach((e) => {
      const cat = e.category || "general";
      if (!categoryMap[cat]) categoryMap[cat] = 0;
      categoryMap[cat] += e.amount;
    });

    const categoryBreakdown = Object.entries(categoryMap)
      .map(([category, total]) => ({
        category,
        total: parseFloat(total.toFixed(2)),
      }))
      .sort((a, b) => b.total - a.total);

    // Total this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyExpenses = await prisma.expense.findMany({
      where: {
        paidById: userId,
        createdAt: { gte: monthStart },
      },
      select: { amount: true },
    });

    const totalThisMonth = monthlyExpenses.reduce((sum, e) => sum + e.amount, 0);

    res.json({
      success: true,
      data: {
        weeklySpending: weeklyData,
        categoryBreakdown,
        totalThisMonth: parseFloat(totalThisMonth.toFixed(2)),
        expenseCount: expenses.length,
      },
    });
  } catch (error) {
    console.error("Insights error:", error);
    res.status(500).json({ success: false, message: "Failed to load insights." });
  }
};

module.exports = { getDashboard, getInsights };
