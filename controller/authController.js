import jwt from "jsonwebtoken";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import { ObjectId } from "mongoose";

// Utility function to generate a JWT token
const generateToken = (payload) => {
  if (!process.env.JWT_SECRET) {
    console.error("ERROR - JWT_SECRET is not defined in environment variables.");
    throw new Error("JWT_SECRET is not defined in environment variables.");
  }
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "10d" });
};

// Utility function to verify a JWT token
const verifyToken = (token) => {
  if (!process.env.JWT_SECRET) {
    console.error("ERROR - JWT_SECRET is not defined in environment variables.");
    throw new Error("JWT_SECRET is not defined in environment variables.");
  }
  return jwt.verify(token, process.env.JWT_SECRET);
};

/**
 * User Login Function
 */
export const login = async (req, res) => {
  console.log("DEBUG - Entering login route");
  try {
    const { email, password } = req.body;
    console.log("DEBUG - Login Attempt for Email:", email);

    const user = await User.findOne({ email }).populate("companyId");
    if (!user) {
      console.log("DEBUG - User not found for email:", email);
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("DEBUG - Invalid password for email:", email);
      return res.status(400).json({ success: false, error: "Invalid password." });
    }

    let tokenPayload = {
      id: user._id,
      role: user.role,
      email: user.email,
    };

    if (user.role !== "Admin") {
      if (!user.companyId) {
        console.error("ERROR: User has no company assigned.");
        return res.status(400).json({ success: false, error: "User is not assigned to a company." });
      }
      tokenPayload.companyId = user.companyId._id;
    }

    const token = generateToken(tokenPayload);
    console.log("Generated token (truncated):", token.slice(0, 10) + "...");

    let companyName = user.companyId ? user.companyId.name : null;

    // Clear old jwt cookie to prevent interference
    res.clearCookie("jwt", { path: "/", httpOnly: true, secure: true, sameSite: "strict" });

    res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        companyId: user.companyId?._id || null,
        companyName,
      },
    });
  } catch (error) {
    console.error("Login Error:", error.message);
    res.status(500).json({ success: false, error: "Server error during login." });
  }
};

/**
 * User Registration Function
 */
export const register = async (req, res) => {
  try {
    const { name, email, password, role, companyId } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    if (role !== "Admin" && !companyId) {
      return res.status(400).json({ success: false, error: "Company ID is required for non-admin users." });
    }

    if (role !== "Admin" && !ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: "Invalid Company ID." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, error: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      companyId: role === "Admin" ? null : companyId,
    });

    await newUser.save();

    res.status(201).json({ success: true, message: "User registered successfully." });
  } catch (error) {
    console.error("Register Error:", error.message);
    res.status(500).json({ success: false, error: "Server error during registration." });
  }
};

/**
 * Verify User Function
 */
export const verify = (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};