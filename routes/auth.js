import express from "express";
import { login, register, verify } from "../controller/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import passport from "passport";
import jwt from "jsonwebtoken";
import "../routes/googleAuth.js"; // Ensure Google OAuth is initialized
import User from "../models/User.js";

const router = express.Router();

/**
 *  Normal Login (Email & Password)
 */
router.post("/login", login);

/**
 *  Normal Registration
 */
router.post("/register", register);

/**
 *  Email Verification (Protected Route)
 */
router.post("/verify", authMiddleware, verify);

/**
 *  Google OAuth Login - Redirect to Google's Auth Page
 */
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

/**
 *  Google OAuth Callback - Handle Google Login Response
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

      //  Generate JWT Token for Authenticated User
      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_KEY,
        { expiresIn: "1d" }
      );

      res.cookie("jwt", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });

      // Redirect User to Dashboard Based on Role
      const redirectPath =
        user.role.toLowerCase() === "manager"
          ? "/manager-dashboard"
          : "/employee-dashboard";

      res.redirect(`${redirectPath}?token=${token}`);
    } catch (error) {
      console.error("Google Auth Error:", error);
      res.redirect("/login");
    }
  }
);

/**
 *  Fetch Authenticated User Details
 */
router.get("/user", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error("Fetch User Error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user data" });
  }
});

export default router;
