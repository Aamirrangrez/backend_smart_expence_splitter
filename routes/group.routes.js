const express = require("express");
const router = express.Router();
const { createGroup, getGroups, getGroupById, addMember, deleteGroup } = require("../controllers/group.controller");
const { authenticate } = require("../middleware/auth.middleware");

router.use(authenticate); // All group routes require auth

router.post("/", createGroup);
router.get("/", getGroups);
router.get("/:id", getGroupById);
router.post("/:id/members", addMember);
router.delete("/:id", deleteGroup);

module.exports = router;
