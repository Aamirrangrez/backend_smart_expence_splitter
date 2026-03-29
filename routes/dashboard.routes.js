const express = require("express");
const router = express.Router();
const { getDashboard, getInsights } = require("../controllers/dashboard.controller");
const { authenticate } = require("../middleware/auth.middleware");

router.use(authenticate);

router.get("/", getDashboard);
router.get("/insights", getInsights);

module.exports = router;
