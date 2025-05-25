import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    type: {
      type: String,
      enum: ["leave_request", "leave_approved", "leave_rejected", "new_message"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    leaveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leave",
      required: false,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: false,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    messageDetails: {
      type: Object, // Store message details like conversationId, senderName
      required: false,
    },
    message: {
      type: Object, // Store the actual message object
      required: false,
    },
  },
  { timestamps: true }
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;