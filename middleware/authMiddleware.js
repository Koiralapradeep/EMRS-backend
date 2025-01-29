import jwt from "jsonwebtoken";
import User from "../models/User.js";

const verifyUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      console.warn("Token not provided");
      return res.status(401).json({ success: false, error: "Token not provided" });
    }

    console.log("Verifying token...");
    const decoded = jwt.verify(token, process.env.JWT_KEY);
    console.log("Token decoded:", decoded);

    const user = await User.findById(decoded._id).select("-password");
    if (!user) {
      console.warn("User not found for token");
      return res.status(404).json({ success: false, error: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Error in token validation:", error);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, error: "Token expired" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

export default verifyUser;
