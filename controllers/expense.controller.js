const prisma = require("../services/prisma");

// POST /api/expenses - Create expense
const createExpense = async (req, res) => {
  try {
    const { title, amount, category, description, groupId, splitBetween, splitType } = req.body;

    if (!title || !amount || !groupId) {
      return res.status(400).json({
        success: false,
        message: "Title, amount, and groupId are required.",
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be a positive number." });
    }

    // Verify group membership
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.id, groupId } },
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: "You are not a member of this group." });
    }

    // Determine who to split between
    let splitUserIds = splitBetween;
    if (!splitUserIds || splitUserIds.length === 0) {
      // Default: split among all group members
      const members = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      splitUserIds = members.map((m) => m.userId);
    }

    // Calculate equal split amount
    const splitAmount = parsedAmount / splitUserIds.length;

    // Create expense with splits in a transaction
    const expense = await prisma.$transaction(async (tx) => {
      const newExpense = await tx.expense.create({
        data: {
          title,
          amount: parsedAmount,
          category: category || "general",
          description,
          groupId,
          paidById: req.user.id,
          splitType: splitType || "equal",
          splits: {
            create: splitUserIds.map((userId) => ({
              userId,
              amount: parseFloat(splitAmount.toFixed(2)),
              paid: userId === req.user.id, // payer's split is already paid
            })),
          },
        },
        include: {
          paidBy: { select: { id: true, name: true, email: true } },
          splits: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
          group: { select: { id: true, name: true, currency: true } },
        },
      });

      return newExpense;
    });

    // Emit real-time event to all group members
    const io = req.app.get("io");
    io.to(`group:${groupId}`).emit("expense:created", { expense });

    res.status(201).json({
      success: true,
      message: "Expense added successfully.",
      data: { expense },
    });
  } catch (error) {
    console.error("Create expense error:", error);
    res.status(500).json({ success: false, message: "Failed to create expense." });
  }
};

// GET /api/expenses/group/:groupId - Get expenses for a group
const getGroupExpenses = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Verify membership
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.id, groupId } },
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where: { groupId },
        include: {
          paidBy: { select: { id: true, name: true, email: true } },
          splits: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
      }),
      prisma.expense.count({ where: { groupId } }),
    ]);

    res.json({
      success: true,
      data: {
        expenses,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get group expenses error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch expenses." });
  }
};

// GET /api/expenses/:id - Get single expense
const getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        paidBy: { select: { id: true, name: true, email: true } },
        splits: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        group: { select: { id: true, name: true, currency: true } },
      },
    });

    if (!expense) {
      return res.status(404).json({ success: false, message: "Expense not found." });
    }

    // Verify access
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user.id, groupId: expense.groupId } },
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.json({ success: true, data: { expense } });
  } catch (error) {
    console.error("Get expense error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch expense." });
  }
};

// PATCH /api/expenses/:id/settle - Mark a split as paid
const settleSplit = async (req, res) => {
  try {
    const { id } = req.params; // expense id
    const { userId } = req.body; // user whose split to settle

    const targetUserId = userId || req.user.id;

    const split = await prisma.split.findUnique({
      where: { expenseId_userId: { expenseId: id, userId: targetUserId } },
      include: { expense: true },
    });

    if (!split) {
      return res.status(404).json({ success: false, message: "Split not found." });
    }

    // Only payer or the user themselves can settle
    if (split.expense.paidById !== req.user.id && targetUserId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Not authorized to settle this split." });
    }

    const updatedSplit = await prisma.split.update({
      where: { expenseId_userId: { expenseId: id, userId: targetUserId } },
      data: { paid: true },
      include: { user: { select: { id: true, name: true } } },
    });

    // Emit real-time event
    const io = req.app.get("io");
    io.to(`group:${split.expense.groupId}`).emit("split:settled", {
      expenseId: id,
      split: updatedSplit,
    });

    res.json({ success: true, message: "Split settled.", data: { split: updatedSplit } });
  } catch (error) {
    console.error("Settle split error:", error);
    res.status(500).json({ success: false, message: "Failed to settle split." });
  }
};

// DELETE /api/expenses/:id - Delete expense
const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) {
      return res.status(404).json({ success: false, message: "Expense not found." });
    }

    if (expense.paidById !== req.user.id) {
      return res.status(403).json({ success: false, message: "Only the payer can delete this expense." });
    }

    await prisma.expense.delete({ where: { id } });

    // Emit real-time event
    const io = req.app.get("io");
    io.to(`group:${expense.groupId}`).emit("expense:deleted", { expenseId: id, groupId: expense.groupId });

    res.json({ success: true, message: "Expense deleted." });
  } catch (error) {
    console.error("Delete expense error:", error);
    res.status(500).json({ success: false, message: "Failed to delete expense." });
  }
};

module.exports = { createExpense, getGroupExpenses, getExpenseById, settleSplit, deleteExpense };
