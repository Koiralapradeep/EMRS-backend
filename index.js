import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./db/DB.js";
import employee from "./routes/employee.js";
import department from "./routes/department.js";
import authRoutes from "./routes/auth.js";
import leave from "./routes/leave.js";  // ✅ Fixed: Added missing import
import setting from "./routes/setting.js"; // ✅ Fixed: Added missing import

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
app.use("/api/leave", leave);   // ✅ Now correctly imported
app.use("/api/setting", setting); // ✅ Now correctly imported

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
