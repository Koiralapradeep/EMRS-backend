import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./db/DB.js";
import employee from './routes/employee.js';
import department from "./routes/department.js";
import authRoutes from "./routes/auth.js"; // Import the auth.js routes
import setting from './routes/setting.js';
import leave from "./routes/leave.js";

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes); // Connect the auth routes
app.use("/public/uploads", express.static("public/uploads")); // Serve uploaded files
app.use("/api/employee", employee);
app.use("/api/departments", department);
app.use("/api/leave", leave);
app.use("/api/setting", setting);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
