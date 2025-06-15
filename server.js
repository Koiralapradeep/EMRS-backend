import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
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
import availability from "./routes/availability.js";
import passport from "passport";
import holiday from "./routes/holidays.js";
import User from './models/User.js';
import shiftswap from "./routes/shiftswap.js";
import admin from "./routes/admin.js";
import messages from './routes/message.js';


process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

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

// Initialize Express app
const app = express();

// Middleware
app.use(cors({
  origin: [process.env.FRONTEND_URL || "http://localhost:5174"],
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
app.use('/api/messages', messages);
app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

// Connect to MongoDB
connectDB().catch((err) => {
  console.error("Failed to connect to DB:", err.message);
});

// Export the app for Vercel
export default app;