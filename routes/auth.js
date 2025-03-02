import express from "express";
import { login, register, verify } from "../controller/authController.js";
import { verifyUser } from "../middleware/authMiddleware.js";
import passport from "passport";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

/**
 *   Normal Login (Email & Password)
 */
router.post("/login", login);

/**
 *   Normal Registration
 */
router.post("/register", register);

/**
 *   Email Verification (Protected Route)
 */
router.post("/verify", verifyUser, verify);

/**
 *   Google OAuth Login - Redirect to Google's Auth Page
 */
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

/**
 *   Google OAuth Callback - Handle Google Login Response
 */
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (req, res) => {
    try {
      if (!req.user) {
        return res.redirect("/not-registered");
      }

      const { email } = req.user;
      let user = await User.findOne({ email });

      if (!user) {
        return res.redirect("/not-registered");
      }

      //  Generate JWT including user ID & companyId
      const token = jwt.sign(
        { id: user._id, role: user.role, companyId: user.companyId?.toString() || null },
        process.env.JWT_KEY,
        { expiresIn: "1d" }
      );

      console.log(" Google OAuth Token Created:", token);

      //  Redirect to frontend with token
      res.redirect(`http://localhost:5173/login?token=${token}`);
    } catch (error) {
      console.error("Google Auth Error:", error);
      res.redirect("/login");
    }
  }
);

/**
 *   Fetch Authenticated User Details (`/api/auth/me`)
 */
router.get("/me", verifyUser, async (req, res) => {
  try {
    console.log("🔹 Fetching Authenticated User:", req.user);

    const user = await User.findById(req.user._id)
      .populate("companyId", "name")
      .select("-password");

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId ? user.companyId._id.toString() : null,
        companyName: user.companyId ? user.companyId.name : "Unknown Company",
      },
    });
  } catch (error) {
    console.error("Fetch User Error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user data" });
  }
});

/**
 *  🔹 Fetch User Profile (`/api/auth/user`)
 */
router.get("/user", verifyUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, error: "User profile not found." });
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error("Fetch User Profile Error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user profile" });
  }
});

export default router;
