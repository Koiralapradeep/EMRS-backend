import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./db/DB.js";
import employee from './routes/employee.js';
import department from "./routes/department.js";
import authRoutes from "./routes/auth.js"; // Import the auth.js routes

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Serve the uploaded images from /public/uploads
app.use("/public/uploads", express.static("public/uploads"));

// Route handlers
app.use("/api/auth", authRoutes);
app.use("/api/employee", employee);
app.use("/api/departments", department);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
