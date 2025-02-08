import User from "../models/User.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";

const changePassword = async (req, res) => {
  try {
    console.log("Request received. Body:", req.body);

    const { userId, currentPassword, newPassword, confirmPassword } = req.body;

    if (!userId || !currentPassword || !newPassword || !confirmPassword) {
      console.warn("Validation failed: Missing fields");
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.warn("Invalid userId format:", userId);
      return res.status(400).json({ success: false, error: "Invalid user ID format." });
    }

    console.log("Fetching user by ID...");
    const user = await User.findById(userId);

    if (!user) {
      console.warn("User not found for ID:", userId);
      return res.status(404).json({ success: false, error: "User not found." });
    }
    console.log("User found:", user);

    try {
      const isPasswordMatch = await bcrypt.compare(currentPassword, user.password);
      console.log("Password match result:", isPasswordMatch);

      if (!isPasswordMatch) {
        console.warn("Current password is incorrect");
        return res.status(400).json({ success: false, error: "Current password is incorrect." });
      }
    } catch (bcryptError) {
      console.error("Error in bcrypt.compare:", bcryptError);
      return res.status(500).json({ success: false, error: "Password comparison failed." });
    }

    if (newPassword !== confirmPassword) {
      console.warn("New password and confirm password do not match");
      return res.status(400).json({ success: false, error: "Passwords do not match." });
    }

    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(newPassword, 10);
      console.log("New hashed password:", hashedPassword);
    } catch (hashError) {
      console.error("Error in bcrypt.hash:", hashError);
      return res.status(500).json({ success: false, error: "Failed to hash password." });
    }

    console.log("Attempting direct database update...");
    try {
      const updateResult = await User.updateOne(
        { _id: userId },
        { $set: { password: hashedPassword } }
      );

      console.log("Update result:", updateResult);

      if (updateResult.nModified === 0) {
        return res.status(400).json({ success: false, error: "Password update failed." });
      }

      console.log("Password updated successfully using direct update.");
      return res.status(200).json({ success: true, message: "Password updated successfully." });
    } catch (updateError) {
      console.error("Error during direct database update:", updateError);
      return res.status(500).json({ success: false, error: "Failed to update password in the database." });
    }
  } catch (error) {
    console.error("Unexpected error in changePassword:", error);
    return res.status(500).json({ success: false, error: "An error occurred while changing the password." });
  }
};

export { changePassword };