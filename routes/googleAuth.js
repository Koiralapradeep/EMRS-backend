import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

console.log("DEBUG [googleAuth.js] - JWT_SECRET:", process.env.JWT_SECRET ? "Defined" : "Undefined");
console.log("DEBUG [googleAuth.js] - GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? "Defined" : "Undefined");
console.log("DEBUG [googleAuth.js] - GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "Defined" : "Undefined");

const router = express.Router();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("DEBUG - Google OAuth profile:", JSON.stringify(profile, null, 2));
        const email = profile.emails[0].value;
        let user = await User.findOne({ email });
        console.log("DEBUG - User query result:", user ? user.email : "No user found");
        if (!user) {
          console.warn(`User with email ${email} not found. Login denied.`);
          return done(null, false);
        }
        console.log("User authenticated via OAuth2:", user.email);
        return done(null, user);
      } catch (error) {
        console.error("Google OAuth Strategy Error:", error.message, error.stack);
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  console.log("DEBUG - Serializing user:", user.email);
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    console.log("DEBUG - Deserializing user:", user ? user.email : "Not found");
    done(null, user);
  } catch (error) {
    console.error("Deserialize User Error:", error.message, error.stack);
    done(error, null);
  }
});

router.get("/google", (req, res, next) => {
  console.log("DEBUG - Incoming request: GET /auth/google");
  console.log("DEBUG - Session before auth:", req.session);
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

router.get(
  "/google/callback",
  (req, res, next) => {
    console.log("DEBUG - Incoming request: GET /auth/google/callback");
    console.log("DEBUG - Callback query params:", req.query);
    console.log("DEBUG - Session before callback:", req.session);
    passport.authenticate("google", {
      failureRedirect: "http://localhost:5174/login?error=user-not-found",
      failureMessage: true,
    })(req, res, next);
  },
  async (req, res) => {
    if (!req.user) {
      console.log("DEBUG - No user found after Google OAuth2 authentication");
      return res.redirect("http://localhost:5174/login?error=user-not-found");
    }
    console.log("DEBUG - User in callback:", req.user.email);
    console.log("DEBUG - Session after callback:", req.session);

    if (!process.env.JWT_SECRET) {
      console.error("ERROR - JWT_SECRET is not defined in environment variables.");
      return res.redirect("http://localhost:5174/login?error=server-error-jwt-secret-missing");
    }

    try {
      const tokenPayload = {
        id: req.user._id,
        email: req.user.email,
        role: req.user.role,
        companyId: req.user.companyId,
      };
      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "10d" });
      console.log("Google OAuth2 - Token generated (truncated):", token.slice(0, 10) + "...");
      console.log("Google OAuth2 - Token payload:", tokenPayload);
      const redirectUrl = `http://localhost:5174/login?token=${encodeURIComponent(token)}`;
      console.log("DEBUG - Redirecting to:", redirectUrl);

      res.redirect(redirectUrl);
    } catch (error) {
      console.error("Error generating token:", error.message, error.stack);
      return res.redirect("http://localhost:5174/login?error=server-error-token-generation-failed");
    }
  }
);

export default router;