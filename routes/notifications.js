import express from "express";
import mongoose from "mongoose";
import Notification from "../models/Notifications.js";
import { verifyUser } from "../middleware/authMiddleware.js";

const router = express.Router();

// Fetch all notifications for the authenticated user
router.get("/", verifyUser, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user._id)) {
      return res.status(400).json({ success: false, error: "Invalid user ID." });
    }

    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      notifications: notifications || [],
    });
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// Mark a notification as read (update isRead field)
// Mark a notification as read (update isRead field)
router.put("/:id/mark-as-read", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Received mark-as-read request for notification ID:", id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log("Invalid notification ID:", id);
      return res.status(400).json({ success: false, error: "Invalid notification ID." });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      console.log("Notification not found for ID:", id);
      return res.status(404).json({ success: false, error: "Notification not found." });
    }

    if (notification.recipient.toString() !== req.user._id.toString()) {
      console.log("Unauthorized access attempt by user:", req.user._id);
      return res.status(403).json({ success: false, error: "Unauthorized." });
    }

    notification.isRead = true;
    await notification.save();

    console.log("Notification marked as read:", notification);

    return res.status(200).json({ success: true, message: "Notification marked as read." });
  } catch (error) {
    console.error("Error marking notification as read:", error.message);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

export default router;