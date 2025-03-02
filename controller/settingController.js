import User from "../models/User.js";
import bcrypt from "bcrypt";

const changePassword = async (req, res) => {
  try {
    console.log("🔹 Change Password Request Received");

    //  Extract userId from the authenticated token
    const userId = req.user._id; // Use token-based authentication
    const { currentPassword, newPassword, confirmPassword } = req.body;

    //  Validate input
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters long." });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: "Passwords do not match." });
    }

    //  Fetch the user from the database
    console.log("🔹 Fetching user by ID...");
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    //  Verify the current password
    const isPasswordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordMatch) {
      return res.status(400).json({ success: false, error: "Current password is incorrect." });
    }

    //  Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    //  Update password in the database
    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    console.log(" Password updated successfully");
    return res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("Error changing password:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};

export { changePassword };
