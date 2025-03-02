import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Configure Google OAuth Strategy
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

        // Only allow existing users (or add auto-creation logic if needed)
        if (!user) {
          console.warn(`User with email ${email} not found. Login denied.`);
          return done(null, false);
        }

        // Generate JWT token with role, companyId, and companyName
        const token = jwt.sign(
          {
            id: user._id,
            email: user.email,
            role: user.role,
            companyId: user.companyId,
            companyName: user.companyName, // Make sure this field exists in your DB
          },
          process.env.JWT_KEY,
          { expiresIn: "10d" }
        );

        console.log("User authenticated via OAuth2:", user.email);
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

// Google OAuth Login Route
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google OAuth Callback Route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "http://localhost:5173/login" }),
  async (req, res) => {
    if (!req.user) {
      return res.redirect("http://localhost:5173/login?error=user-not-found");
    }

    const token = req.user.token;
    console.log("Google OAuth2 - Token generated:", token);

    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });

    // Redirect to frontend with token as query parameter
    res.redirect(`http://localhost:5173/login?token=${token}`);
  }
);

export default router;
