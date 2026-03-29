const prisma = require("../services/prisma");

// GET /api/dashboard
const getDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // ✅ All 3 queries run IN PARALLEL — total time = slowest single query
    const [youOweSplits, owedToYouSplits, recentExpenses] = await Promise.all([

      // Splits where user owes money
      prisma.split.findMany({
        where: {
          userId,
          paid: false,
          expense: { paidById: { not: userId } },
        },
        include: {
          expense: {
            include: {
              paidBy: { select: { id: true, name: true, email: true } },
              group: { select: { id: true, name: true, currency: true } },
            },
          },
        },
        take: 20, // ✅ limit to prevent huge payloads
      }),

      // Splits where others owe the user
      prisma.split.findMany({
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
        take: 20, // ✅ limit
      }),

      // Recent expenses
      prisma.expense.findMany({
        where: {
          group: { members: { some: { userId } } },
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
      }),
    ]);

    // Calculate totals from already-fetched data (no extra DB calls)
    const totalYouOwe = youOweSplits.reduce((sum, s) => sum + s.amount, 0);
    const totalOwedToYou = owedToYouSplits.reduce((sum, s) => sum + s.amount, 0);

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
        groupBalances: [], // ✅ removed expensive groups query — not used in DashboardPage
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ success: false, message: "Failed to load dashboard." });
  }
};

// GET /api/dashboard/insights
const getInsights = async (req, res) => {
  try {
    const userId = req.user.id;

    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // ✅ Both queries run in parallel
    const [expenses, monthlyExpenses] = await Promise.all([
      prisma.expense.findMany({
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
      }),

      prisma.expense.aggregate({
        where: {
          paidById: userId,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Weekly breakdown
    const weeklyData = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - i * 7 - 6);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      weekEnd.setHours(23, 59, 59, 999);

      const total = expenses
        .filter((e) => {
          const d = new Date(e.createdAt);
          return d >= weekStart && d <= weekEnd;
        })
        .reduce((sum, e) => sum + e.amount, 0);

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
      categoryMap[cat] = (categoryMap[cat] || 0) + e.amount;
    });

    const categoryBreakdown = Object.entries(categoryMap)
      .map(([category, total]) => ({ category, total: parseFloat(total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      data: {
        weeklySpending: weeklyData,
        categoryBreakdown,
        // ✅ Use aggregate result instead of fetching all monthly expenses
        totalThisMonth: parseFloat((monthlyExpenses._sum.amount || 0).toFixed(2)),
        expenseCount: expenses.length,
      },
    });
  } catch (error) {
    console.error("Insights error:", error);
    res.status(500).json({ success: false, message: "Failed to load insights." });
  }
};

module.exports = { getDashboard, getInsights };