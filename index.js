import express from "express";
import session from "express-session";
import passport from "passport";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./db/DB.js";
import authRoutes from "./routes/auth.js";
import googleAuth from "./routes/googleAuth.js";
import employee from "./routes/employee.js";
import departments from "./routes/department.js";
import leave from "./routes/leave.js";
import setting from "./routes/setting.js";
import feedback from "./routes/feedback.js";

dotenv.config();
const app = express();

// Enable CORS to allow frontend requests
app.use(cors({
  origin: "http://localhost:5173", 
  credentials: true
}));

app.use(express.json());

// Serve the uploaded images from /public/uploads
app.use("/public/uploads", express.static("public/uploads"));

//  Add Session Middleware (Fixes Login Session Error)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "jwtSecretKeyAAA33333@@@####888899999",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production", // HTTPS only in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);

//  Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

//  Use API Routes
app.use("/api/auth", authRoutes);
app.use("/auth", googleAuth);
app.use("/api/employee", employee);
app.use("/api/departments", departments);
app.use("/api/leave", leave);
app.use("/api/setting", setting);
app.use("/api/feedback", feedback);


//  Start Server
const PORT = process.env.PORT || 3000;
connectDB();
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
