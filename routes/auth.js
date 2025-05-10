import express from "express";
import { login, register, verify } from "../controller/authController.js";
import { verifyUser } from "../middleware/authMiddleware.js";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from 'bcrypt';

const router = express.Router();

// Debug environment variables on server start
console.log("Loaded EMAIL_USER:", process.env.EMAIL_USER);
console.log("Loaded EMAIL_PASS:", process.env.EMAIL_PASS);
console.log("Loaded FRONTEND_URL:", process.env.FRONTEND_URL);

// Validate environment variables
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.error("Critical: EMAIL_USER or EMAIL_PASS not set in environment variables");
}

// Configure Nodemailer for Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Test Email Sending
router.get("/test-email", async (req, res) => {
  try {
    console.log("Attempting to send test email to itsduominds@gmail.com...");
    await transporter.sendMail({
      to: "itsduominds@gmail.com",
      from: process.env.EMAIL_USER,
      subject: "Test Email",
      html: "<p>This is a test email from your application.</p>",
    });
    console.log("Test email sent successfully");
    res.json({ success: true, message: "Test email sent" });
  } catch (err) {
    console.error("Test Email Error:", {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    res.status(500).json({ success: false, error: "Failed to send test email" });
  }
});

// Normal Login (Email & Password)
router.post("/login", (req, res) => {
  console.log("DEBUG - Incoming request: POST /api/auth/login");
  login(req, res);
});

// Normal Registration
router.post("/register", (req, res) => {
  console.log("DEBUG - Incoming request: POST /api/auth/register");
  register(req, res);
});

// Email Verification (Protected Route)
router.post("/verify", verifyUser, (req, res) => {
  console.log("DEBUG - Incoming request: POST /api/auth/verify");
  verify(req, res);
});

// Fetch Authenticated User Details (`/api/auth/me`)
router.get("/me", verifyUser, async (req, res) => {
  try {
    console.log("DEBUG - Incoming request: GET /api/auth/me");
    console.log("🔹 Fetching Authenticated User:", req.user);

    const user = await User.findById(req.user._id)
      .populate("companyId", "name")
      .select("-password");

    if (!user) {
      console.error("ERROR - User not found for ID:", req.user._id);
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const responseData = {
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId ? user.companyId._id.toString() : null,
        companyName: user.companyId ? user.companyId.name : "Unknown Company",
      },
    };
    console.log("DEBUG - Sending response from /api/auth/me:", responseData);
    res.json(responseData);
  } catch (error) {
    console.error("Fetch User Error in /api/auth/me:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch user data" });
  }
});

// Fetch User Profile (`/api/auth/user`)
router.get("/user", verifyUser, async (req, res) => {
  try {
    console.log("DEBUG - Incoming request: GET /api/auth/user");
    console.log("Session exists:", !!req.session);

    if (!req.session || !req.session.user) {
      console.warn("Session invalid or destroyed for user:", req.user.email);
      return res.status(401).json({ success: false, error: "Session invalid or destroyed." });
    }

    const user = await User.findById(req.user._id)
      .select("-password")
      .populate("companyId", "name");

    if (!user) {
      console.error("ERROR - User not found for ID:", req.user._id);
      return res.status(404).json({ success: false, error: "User profile not found." });
    }

    const responseData = {
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId ? user.companyId._id.toString() : null,
        companyName: user.companyId ? user.companyId.name : "Unknown Company",
      },
    };
    console.log("DEBUG - Sending response from /api/auth/user:", responseData);

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.json(responseData);
  } catch (error) {
    console.error("Fetch User Profile Error in /api/auth/user:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch user profile" });
  }
});

// Logout (`/api/auth/logout`)
router.post("/logout", (req, res) => {
  console.log("DEBUG - Incoming request: POST /api/auth/logout");
  console.log("DEBUG - Session before logout:", req.session);

  if (!req.session) {
    console.log("DEBUG - No session found to destroy");
    res.clearCookie("connect.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    return res.status(200).json({ success: true, message: "Logged out successfully (no session)" });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err.message);
      return res.status(500).json({ success: false, message: "Failed to log out" });
    }

    console.log("DEBUG - Session after logout:", req.session);
    res.clearCookie("connect.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    console.log("DEBUG - Cleared connect.sid cookie on backend");
    res.status(200).json({ success: true, message: "Logged out successfully" });
  });
});

// Forgot Password
router.post("/forgot-password", async (req, res) => {
  console.log("DEBUG - Incoming request: POST /api/auth/forgot-password");
  console.log("Request body:", req.body);

  const { email } = req.body;

  if (!email) {
    console.log("Validation failed: Email is required");
    return res.status(400).json({ success: false, error: "Email is required" });
  }

  try {
    console.log("Step 1: Checking environment variables...");
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("Email credentials missing: EMAIL_USER or EMAIL_PASS not set");
      return res.status(500).json({
        success: false,
        error: "Email service not configured. Please contact support.",
      });
    }

    console.log("Step 2: Searching for user with email:", email);
    const user = await User.findOne({ email });
    console.log("Step 3: User lookup result:", user ? `Found user ${user.email}` : "No user found");

    if (!user) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      return res.json({
        success: true,
        message: "If an account exists with this email, a reset link has been sent",
      });
    }

    console.log("Step 4: Generating reset token...");
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();
    console.log("Step 5: Reset token saved for user:", user.email);

    console.log("Step 6: Preparing email with reset URL...");
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    console.log("Step 7: Sending email to:", user.email, "with reset URL:", resetUrl);
    await transporter.sendMail({
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: "Password Reset Request",
      html: `
        <p>Hello ${user.name || "User"},</p>
        <p>You requested a password reset for your account.</p>
        <p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
        <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
      `,
    });

    console.log("Step 8: Email sent successfully to", user.email);
    res.json({
      success: true,
      message: "Password reset link has been sent to your email",
    });
  } catch (err) {
    console.error("Forgot Password Error:", {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    res.status(500).json({
      success: false,
      error: "An error occurred while processing your request",
    });
  }
});

// Reset Password
router.post("/reset-password", async (req, res) => {
  console.log("DEBUG - Incoming request: POST /api/auth/reset-password");
  console.log("Request body:", req.body);

  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, error: "Token and new password are required" });
  }

  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      console.log(`Invalid or expired reset token: ${token}`);
      return res.status(400).json({ success: false, error: "Invalid or expired reset token" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters long" });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Clear reset token and expiry
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    // Save the updated user
    await user.save();

    console.log(`Password reset successfully for user: ${user.email}`);
    res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset Password Error:", {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    res.status(500).json({ success: false, error: "An error occurred while resetting the password" });
  }
});

export default router;