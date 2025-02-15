import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// ✅ Configure Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback", // Backend callback
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        let user = await User.findOne({ email });

        if (!user) {
          return done(null, false); // ❌ User not found
        }

        // ✅ Generate JWT Token
        const token = jwt.sign(
          { _id: user._id, role: user.role },
          process.env.JWT_KEY,
          { expiresIn: "10d" }
        );

        return done(null, { user, token });
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// ✅ Google OAuth Login Route
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// ✅ Google OAuth Callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (req, res) => {
    if (!req.user) {
      return res.redirect("http://localhost:5173/not-registered"); // Redirect to frontend
    }

    const token = req.user.token;

    // ✅ Redirect based on user role to frontend
    const redirectURL =
      req.user.user.role === "Manager"
        ? `http://localhost:5173/manager-dashboard?token=${token}`
        : `http://localhost:5173/employee-dashboard?token=${token}`;

    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });

    res.redirect(redirectURL);
  }
);

export default router;
