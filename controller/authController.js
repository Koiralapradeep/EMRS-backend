import jwt from "jsonwebtoken";
import User from "../models/User.js";
import bcrypt from "bcrypt";

/**
 * User Login Function
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("DEBUG - Login Attempt for Email:", email);

    // Find user (Admins do not have a companyId)
    const user = await User.findOne({ email }).populate("companyId");
    console.log("DEBUG - Found User Data:", user);

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Invalid password." });
    }

    // Build token payload
    let tokenPayload = {
      id: user._id,
      role: user.role,
      email: user.email,
    };

    // If user is not an Admin, ensure they have a company
    if (user.role !== "Admin") {
      if (!user.companyId) {
        console.error("ERROR: User has no company assigned.");
        return res.status(400).json({ success: false, error: "User is not assigned to a company." });
      }
      tokenPayload.companyId = user.companyId._id;
    }

    // Generate JWT Token
    const token = jwt.sign(tokenPayload, process.env.JWT_KEY, { expiresIn: "10d" });

    // Determine companyName if user has a company
    let companyName = null;
    if (user.companyId) {
      companyName = user.companyId.name;
    }

    console.log("DEBUG - Sending User Response:", {
      _id: user._id,
      name: user.name,
      role: user.role,
      companyId: user.companyId?._id || null,
      companyName,
    });

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

    // Validate input
    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    // Non-admin users require a company ID
    if (role !== "Admin" && !companyId) {
      return res.status(400).json({ success: false, error: "Company ID is required for non-admin users." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, error: "User already exists." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (Admins do not have a companyId)
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
 * Verify User Function (returns the user stored by the verifyUser middleware)
 */
export const verify = (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};
