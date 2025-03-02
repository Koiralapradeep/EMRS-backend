import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Verify User Middleware (Ensures user authentication)
 */
const verifyUser = async (req, res, next) => {
  try {
    console.log("🔍 Incoming Headers:", req.headers);

    //  Extract token from Authorization header or cookies
    let token;
    if (req.headers.authorization) {
      const authParts = req.headers.authorization.split(" ");
      if (authParts.length === 2 && authParts[0] === "Bearer") {
        token = authParts[1];
      }
    }
    if (!token && req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      console.error("AUTH ERROR: No token provided.");
      return res.status(401).json({ success: false, error: "Unauthorized: No token provided" });
    }

    console.log("Extracted Token:", token);

    //  Decode and verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_KEY);
    } catch (err) {
      console.error("AUTH ERROR: Invalid or expired token:", err.message);
      return res.status(401).json({ success: false, error: "Invalid or expired token" });
    }

    if (!decoded?.id) {
      console.error("AUTH ERROR: Missing user ID in token payload.");
      return res.status(401).json({ success: false, error: "Invalid token payload" });
    }

    //  Fetch user from database and populate company if needed
    const user = await User.findById(decoded.id).select("-password").populate("companyId", "name");
    if (!user) {
      console.error("AUTH ERROR: User not found.");
      return res.status(404).json({ success: false, error: "User not found" });
    }

    //  Attach user data to req
    req.user = {
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      // If user.companyId is an ObjectId reference, we store the _id as a string:
      companyId: user.companyId ? user.companyId._id.toString() : null,
      companyName: user.companyId ? user.companyId.name : "No Company",
    };

    console.log(`DEBUG - Middleware assigned companyId: ${req.user.companyId || "N/A"} for User: ${user.email}`);

    next();
  } catch (error) {
    console.error("AUTH ERROR (unexpected):", error.message);
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

/**
 * Role-Based Authorization Middleware
 */
const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      console.error(`Access denied for role: ${req.user ? req.user.role : "undefined"}`);
      return res.status(403).json({ success: false, error: "Access denied" });
    }
    next();
  };
};

export { verifyUser, authorizeRoles };
