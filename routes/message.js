import express from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Messages.js";
import { verifyUser } from "../middleware/authMiddleware.js";
import createNotification from "../Util/NotificationUtils.js";

const router = express.Router();

// Get all conversations for the authenticated user
router.get("/conversations", verifyUser, async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: "Invalid company ID." });
    }

    const conversations = await Conversation.find({
      participants: req.user._id,
      companyId,
    })
      .populate("participants", "name role")
      .populate("lastMessage")
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// Get messages for a specific conversation
router.get("/conversations/:conversationId/messages", verifyUser, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, error: "Invalid conversation ID." });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    if (!conversation.participants.includes(req.user._id)) {
      return res.status(403).json({ success: false, error: "Unauthorized." });
    }

    const messages = await Message.find({ conversationId })
      .populate("sender", "name")
      .sort({ createdAt: 1 })
      .lean();

    return res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// Create a new conversation
router.post("/conversations", verifyUser, async (req, res) => {
  try {
    const { participantIds, companyId } = req.body;

    // Validate participantIds
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ success: false, error: "Participant IDs are required." });
    }

    // Validate companyId
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: "Invalid company ID." });
    }

    // Validate req.user._id
    if (!mongoose.Types.ObjectId.isValid(req.user._id)) {
      return res.status(400).json({ success: false, error: "Invalid user ID." });
    }

    // Validate each participantId
    const invalidParticipantIds = participantIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id)
    );
    if (invalidParticipantIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid participant ID(s): ${invalidParticipantIds.join(", ")}`,
      });
    }

    // Explicitly cast to ObjectId
    const participants = [req.user._id, ...participantIds].map((id) =>
      new mongoose.Types.ObjectId(id)
    );
    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    // Check if the company exists
    const Company = mongoose.model("Company");
    const companyExists = await Company.findById(companyObjectId);
    if (!companyExists) {
      return res.status(404).json({ success: false, error: "Company not found." });
    }

    // Check if all participants exist
    const User = mongoose.model("User");
    const usersExist = await User.find({ _id: { $in: participants } });
    if (usersExist.length !== participants.length) {
      const missingUsers = participants.filter(
        (id) => !usersExist.some((user) => user._id.toString() === id.toString())
      );
      return res.status(404).json({
        success: false,
        error: `User(s) not found: ${missingUsers.join(", ")}`,
      });
    }

    // Check MongoDB connection state
    if (mongoose.connection.readyState !== 1) {
      console.error("MongoDB connection is not ready:", mongoose.connection.readyState);
      return res.status(503).json({ success: false, error: "Database connection unavailable." });
    }

    const conversation = new Conversation({
      participants,
      companyId: companyObjectId,
    });

    console.log("DEBUG - Conversation before save:", conversation);

    await conversation.save();

    console.log("DEBUG - Conversation after save:", conversation);

    // Attempt to populate participants, but don't fail if it doesn't work
    try {
      await conversation.populate("participants", "name role");
      console.log("DEBUG - Conversation after populate:", conversation);
    } catch (populateError) {
      console.warn("Warning: Failed to populate participants:", populateError);
      conversation.participants = participants; // Fallback to raw ObjectIds
    }

    return res.status(201).json(conversation);
  } catch (error) {
    console.error("Error creating conversation:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// Send a new message
router.post("/", verifyUser, async (req, res) => {
  try {
    const { conversationId, senderId, content, companyId } = req.body;

    // Validate conversationId and companyId
    if (!mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: "Invalid conversation or company ID." });
    }

    // Validate senderId
    if (!mongoose.Types.ObjectId.isValid(senderId)) {
      return res.status(400).json({ success: false, error: "Invalid sender ID." });
    }

    // Validate content
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: "Message content is required." });
    }

    // Check if the conversation exists
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    // Check if the user is authorized
    if (!conversation.participants.includes(req.user._id)) {
      return res.status(403).json({ success: false, error: "Unauthorized." });
    }

    // Check if the sender exists
    const User = mongoose.model("User");
    const senderExists = await User.findById(senderId);
    if (!senderExists) {
      return res.status(404).json({ success: false, error: "Sender not found." });
    }

    // Check MongoDB connection state
    if (mongoose.connection.readyState !== 1) {
      console.error("MongoDB connection is not ready:", mongoose.connection.readyState);
      return res.status(503).json({ success: false, error: "Database connection unavailable." });
    }

    const message = new Message({
      conversationId: new mongoose.Types.ObjectId(conversationId),
      sender: new mongoose.Types.ObjectId(senderId),
      content,
      companyId: new mongoose.Types.ObjectId(companyId),
    });

    console.log("DEBUG - Message before save:", message);

    await message.save();

    console.log("DEBUG - Message after save:", message);

    // Populate sender, but don't fail if it doesn't work
    try {
      await message.populate("sender", "name");
      console.log("DEBUG - Message after populate:", message);
    } catch (populateError) {
      console.warn("Warning: Failed to populate sender:", populateError);
      message.sender = senderId; // Fallback to raw ObjectId
    }

    // Update conversation's last message
    conversation.lastMessage = message._id;
    await conversation.save();

    console.log("DEBUG - Conversation updated with lastMessage:", conversation);

    // Create notification for other participants
    const io = req.app.get("io");
    if (!io) {
      console.warn("Socket.IO instance not found. Notifications will not be sent.");
    } else {
      const otherParticipants = conversation.participants.filter(
        (p) => p.toString() !== req.user._id.toString()
      );
      console.log("DEBUG - Notifying participants:", otherParticipants);
      for (const participantId of otherParticipants) {
        try {
          const notification = await createNotification(io, {
            recipientId: participantId,
            senderId: req.user._id,
            type: "new_message",
            messageDetails: {
              conversationId,
              senderName: req.user.name,
            },
            message,
          });
          console.log(`DEBUG - Notification created with ID: ${notification._id} for ${participantId}`);
          io.to(participantId.toString()).emit("newMessage", {
            ...notification,
            message,
            messageDetails: {
              conversationId,
              senderName: req.user.name,
            },
          });
          console.log(`DEBUG - Emitted newMessage event to ${participantId}`);
        } catch (notificationError) {
          console.warn("Failed to send notification to participant:", participantId, notificationError);
        }
      }
    }

    return res.status(201).json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

export default router;