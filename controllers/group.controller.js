const prisma = require("../services/prisma");

// POST /api/groups - Create a group
const createGroup = async (req, res) => {
  try {
    const { name, description, currency, memberEmails } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Group name is required." });
    }

    // Find users by emails (if provided)
    let memberIds = [];
    if (memberEmails && memberEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: memberEmails } },
        select: { id: true, email: true },
      });
      memberIds = users.map((u) => u.id);
    }

    // Create group with creator + members
    const group = await prisma.group.create({
      data: {
        name,
        description,
        currency: currency || "INR",
        createdById: req.user.id,
        members: {
          create: [
            // Creator is always admin
            { userId: req.user.id, role: "admin" },
            // Add other members
            ...memberIds
              .filter((id) => id !== req.user.id)
              .map((id) => ({ userId: id, role: "member" })),
          ],
        },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: "Group created successfully.",
      data: { group },
    });
  } catch (error) {
    console.error("Create group error:", error);
    res.status(500).json({ success: false, message: "Failed to create group." });
  }
};

// GET /api/groups - Get all groups for the user
const getGroups = async (req, res) => {
  try {
    const groups = await prisma.group.findMany({
      where: {
        members: { some: { userId: req.user.id } },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { expenses: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ success: true, data: { groups } });
  } catch (error) {
    console.error("Get groups error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch groups." });
  }
};

// GET /api/groups/:id - Get single group
const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        expenses: {
          include: {
            paidBy: { select: { id: true, name: true, email: true } },
            splits: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    // Check membership
    const isMember = group.members.some((m) => m.userId === req.user.id);
    if (!isMember) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.json({ success: true, data: { group } });
  } catch (error) {
    console.error("Get group error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch group." });
  }
};

// POST /api/groups/:id/members - Add member
const addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    // Check group exists
    const group = await prisma.group.findUnique({
      where: { id },
      include: { members: true },
    });

    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    // Check requester is admin or creator
    const requesterMember = group.members.find((m) => m.userId === req.user.id);
    if (!requesterMember || requesterMember.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admins can add members." });
    }

    // Find the user to add
    const userToAdd = await prisma.user.findUnique({ where: { email } });
    if (!userToAdd) {
      return res.status(404).json({ success: false, message: "User with this email not found." });
    }

    // Check if already a member
    const alreadyMember = group.members.some((m) => m.userId === userToAdd.id);
    if (alreadyMember) {
      return res.status(409).json({ success: false, message: "User is already a member." });
    }

    const newMember = await prisma.groupMember.create({
      data: { groupId: id, userId: userToAdd.id, role: "member" },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // Emit real-time event
    const io = req.app.get("io");
    io.to(`group:${id}`).emit("group:member_added", { groupId: id, member: newMember });

    res.status(201).json({
      success: true,
      message: "Member added successfully.",
      data: { member: newMember },
    });
  } catch (error) {
    console.error("Add member error:", error);
    res.status(500).json({ success: false, message: "Failed to add member." });
  }
};

// DELETE /api/groups/:id - Delete group
const deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found." });
    }

    if (group.createdById !== req.user.id) {
      return res.status(403).json({ success: false, message: "Only the group creator can delete it." });
    }

    await prisma.group.delete({ where: { id } });

    res.json({ success: true, message: "Group deleted successfully." });
  } catch (error) {
    console.error("Delete group error:", error);
    res.status(500).json({ success: false, message: "Failed to delete group." });
  }
};

module.exports = { createGroup, getGroups, getGroupById, addMember, deleteGroup };
