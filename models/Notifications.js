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
      enum: ["leave_request", "leave_approved", "leave_rejected"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    leaveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leave", // Reference to the Leave model
      required: false, // Not all notifications will be related to a leave request
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;