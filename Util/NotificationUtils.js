import Notification from "../models/Notifications.js";
import User from "../models/User.js";

const createNotification = async (io, { recipientId, senderId, type, leaveDetails }) => {
  try {
    const sender = await User.findById(senderId); // Fetch sender details
    const recipient = await User.findById(recipientId); // Fetch recipient details

    let message;
    switch (type) {
      case "leave_request":
        message = `${sender?.name || "An employee"} has submitted a leave request for ${leaveDetails?.startDate} to ${leaveDetails?.endDate}.`;
        break;
      case "leave_approved":
        message = `Your leave request for ${leaveDetails?.startDate} to ${leaveDetails?.endDate} has been approved by ${sender?.name || "your manager"}.`;
        break;
      case "leave_rejected":
        message = `Your leave request for ${leaveDetails?.startDate} to ${leaveDetails?.endDate} has been rejected by ${sender?.name || "your manager"}.`;
        break;
      default:
        message = "You have a new notification.";
    }

    const notification = new Notification({
      recipient: recipientId,
      sender: senderId,
      type,
      message,
      isRead: false,
    });

    await notification.save();

    // Emit the notification via Socket.IO to the recipient
    io.to(recipientId.toString()).emit("notification", notification);

    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

export default createNotification;