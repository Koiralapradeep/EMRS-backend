import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo"; // Add this import
import connectDB from "./db/DB.js";
import authRoutes from "./routes/auth.js";
import googleAuth from "./routes/googleAuth.js";
import employee from "./routes/employee.js";
import departments from "./routes/department.js";
import leave from "./routes/leave.js";
import setting from "./routes/setting.js";
import feedback from "./routes/feedback.js";
import company from "./routes/company.js";
import manager from "./routes/manager.js";
import notifications from "./routes/notifications.js";
import { Server } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import availability from "./routes/availability.js";
import passport from "passport";
import holiday from "./routes/holidays.js";
import User from './models/User.js';
import shiftswap from "./routes/shiftswap.js";
import admin from "./routes/admin.js";

// Load environment variables first
dotenv.config({ path: './.env' });
console.log('DEBUG - Loaded .env file');

// Validate environment variables
const requiredEnvVars = ["JWT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MONGO_URI"];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`ERROR: Missing environment variable: ${varName}`);
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

// Log environment variables for debugging
console.log("DEBUG - MONGO_URI:", process.env.MONGO_URI);
console.log("DEBUG - JWT_SECRET:", process.env.JWT_SECRET ? "Defined" : "Undefined");
console.log("DEBUG - GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? "Defined" : "Undefined");
console.log("DEBUG - GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "Defined" : "Undefined");
console.log("DEBUG - PORT:", process.env.PORT || 3000);
console.log("DEBUG - SESSION_SECRET:", process.env.SESSION_SECRET ? "Defined" : "Undefined");

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5174",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

// WebSocket user map and connection handling
const users = new Map();
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.on("register", (token) => {
    try {
      if (!token || token.length < 20) {
        console.log("Invalid or missing token. Registration failed.");
        socket.emit("auth_error", { message: "Invalid token. Please re-authenticate." });
        return;
      }
      if (!process.env.JWT_SECRET) {
        console.error("ERROR - JWT_SECRET is not defined in environment variables.");
        socket.emit("auth_error", { message: "Server error: JWT_SECRET missing." });
        return;
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded || !decoded.id) {
        console.log("Invalid token. Cannot extract user ID.");
        socket.emit("auth_error", { message: "Invalid token. Please re-authenticate." });
        return;
      }
      const userId = decoded.id.toString();
      users.set(userId, socket.id);
      console.log(`User ${userId} registered with socket ID ${socket.id}`);
    } catch (error) {
      console.error("Error verifying token in WebSocket:", error.message);
      socket.emit("auth_error", { message: "Invalid token. Please re-authenticate." });
    }
  });
  socket.on("disconnect", (reason) => {
    console.log(`User disconnected: ${socket.id}, Reason: ${reason}`);
    for (const [userId, socketId] of users.entries()) {
      if (socketId === socket.id) {
        users.delete(userId);
        console.log(`User ${userId} removed from active connections`);
        break;
      }
    }
  });
  socket.on("reconnect_attempt", () => {
    console.log("WebSocket trying to reconnect...");
  });
  socket.on("reconnect", () => {
    console.log("WebSocket reconnected.");
  });
  socket.on("reconnect_error", (error) => {
    console.error("WebSocket reconnection error:", error.message);
  });
});

export const sendNotification = async (recipientId, notificationData) => {
  try {
    const socketId = users.get(recipientId.toString());
    if (socketId) {
      io.to(socketId).emit("notification", notificationData);
      console.log(`Notification sent to user ${recipientId} at socket ${socketId}: ${notificationData.message}`);
    } else {
      console.log(`User ${recipientId} is offline. Notification stored in DB.`);
    }
  } catch (error) {
    console.error(`Failed to send notification to ${recipientId}:`, error.message);
  }
};

// Middleware
app.use(cors({
  origin: "http://localhost:5174",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Session middleware with MongoStore
app.use(
  session({
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Serve static files and routes
app.use("/public/uploads", express.static("public/uploads"));
app.use((req, res, next) => {
  console.log(`DEBUG - Incoming request: ${req.method} ${req.url}`);
  next();
});
app.use("/api/auth", authRoutes);
app.use("/auth", googleAuth);
app.use("/api/employee", employee);
app.use("/api/departments", departments);
app.use("/api/leave", leave);
app.use("/api/setting", setting);
app.use("/api/feedback", feedback);
app.use("/api/company", company);
app.use("/api/manager", manager);
app.use("/api/notifications", notifications);
app.use("/api/availability", availability);
app.use("/api/holidays", holiday);
app.use('/api/users', User);
app.use('/api/shift-swap', shiftswap);
app.use('/api/admin', admin);
app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

// Start server
const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch((err) => {
  console.error("Failed to start server due to DB connection error:", err.message);
});