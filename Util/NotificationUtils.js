import Notification from "../models/Notifications.js";
import User from "../models/User.js";

const createNotification = async (io, { recipientId, senderId, type, leaveDetails, messageDetails, message }) => {
  try {
    const sender = await User.findById(senderId);
    const recipient = await User.findById(recipientId);

    let notificationMessage;
    switch (type) {
      case "leave_request":
        notificationMessage = `${sender?.name || "An employee"} has submitted a leave request for ${leaveDetails?.startDate} to ${leaveDetails?.endDate}.`;
        break;
      case "leave_approved":
        notificationMessage = `Your leave request for ${leaveDetails?.startDate} to ${leaveDetails?.endDate} has been approved by ${sender?.name || "your manager"}.`;
        break;
      case "leave_rejected":
        notificationMessage = `Your leave request for ${leaveDetails?.startDate} to ${leaveDetails?.endDate} has been rejected by ${sender?.name || "your manager"}.`;
        break;
      case "new_message":
        notificationMessage = `You have a new message from ${sender?.name || "a colleague"}.`;
        break;
      default:
        notificationMessage = "You have a new notification.";
    }

    const notification = new Notification({
      recipient: recipientId,
      sender: senderId,
      type,
      message: notificationMessage,
      isRead: false,
      conversationId: messageDetails?.conversationId,
      messageDetails: type === "new_message" ? messageDetails : undefined,
      message: type === "new_message" ? message : undefined,
    });

    console.log("DEBUG - Creating notification:", {
      recipientId,
      senderId,
      type,
      notificationMessage,
      conversationId: messageDetails?.conversationId,
      messageDetails,
      message,
    });

    await notification.save();

    console.log("DEBUG - Notification saved:", notification.toObject());

    io.to(recipientId.toString()).emit("notification", notification);

    console.log("DEBUG - Emitted notification event to:", recipientId);

    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

export default createNotification;