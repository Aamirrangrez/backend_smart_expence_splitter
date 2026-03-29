const express = require("express");
const router = express.Router();
const { createExpense, getGroupExpenses, getExpenseById, settleSplit, deleteExpense } = require("../controllers/expense.controller");
const { authenticate } = require("../middleware/auth.middleware");

router.use(authenticate);

router.post("/", createExpense);
router.get("/group/:groupId", getGroupExpenses);
router.get("/:id", getExpenseById);
router.patch("/:id/settle", settleSplit);
router.delete("/:id", deleteExpense);

module.exports = router;
