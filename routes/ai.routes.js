const express = require("express");
const router = express.Router();
const { parseExpense, getStatus } = require("../controllers/ai.controller");
const { authenticate } = require("../middleware/auth.middleware");

router.use(authenticate);

router.post("/parse-expense", parseExpense);
router.get("/status", getStatus);       // GET /api/ai/status — check Ollama health

module.exports = router;
