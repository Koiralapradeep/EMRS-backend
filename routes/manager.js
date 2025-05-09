import express from "express";
import Employee from "../models/Employee.js";
import Department from "../models/Department.js";
import Leave from "../models/Leave.js";
import { verifyUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/summary", verifyUser, authorizeRoles(["manager", "employee"]), async (req, res) => {
  try {
    console.log("DEBUG - req.user:", req.user);

    const companyId = req.user.companyId;
    if (!companyId) {
      console.log("DEBUG - No companyId found for user:", req.user._id);
      return res.status(400).json({ success: false, message: "User is not associated with a company" });
    }

    console.log("DEBUG - Company ID:", companyId);

    const role = req.user.role.toLowerCase();
    let response = { success: true };

    // Leave details (specific to role)
    if (role === "manager") {
      // Company-wide leave counts for managers
      console.log("DEBUG - Fetching company-wide leaves for companyId:", companyId);
      
      const pending = await Leave.countDocuments({ companyId, status: { $regex: "^pending$", $options: "i" } });
      const approved = await Leave.countDocuments({ companyId, status: { $regex: "^approved$", $options: "i" } });
      const rejected = await Leave.countDocuments({ companyId, status: { $regex: "^rejected$", $options: "i" } });

      console.log("DEBUG - Manager - Pending leaves:", pending);
      console.log("DEBUG - Manager - Approved leaves:", approved);
      console.log("DEBUG - Manager - Rejected leaves:", rejected);

      response.summary = [
        { title: "Total Employees", value: await Employee.countDocuments({ companyId }), icon: "faUsers", bgColor: "bg-blue-500" },
        { title: "Departments", value: await Department.countDocuments({ companyId }), icon: "faBuilding", bgColor: "bg-green-500" },
      ];
      response.leaveDetails = [
        { title: "Pending Leave", value: pending, icon: "faClock", bgColor: "bg-yellow-500" },
        { title: "Approved Leave", value: approved, icon: "faCheck", bgColor: "bg-green-500" },
        { title: "Rejected Leave", value: rejected, icon: "faTimes", bgColor: "bg-red-500" },
      ];
    } else if (role === "employee") {
      // Employee-specific leave counts using companyId and userId
      const userId = req.user._id;
      console.log("DEBUG - Fetching leaves for companyId:", companyId, "and userId:", userId);

      // Directly query leaves for this employee
      const pending = await Leave.countDocuments({ companyId, userId, status: { $regex: "^pending$", $options: "i" } });
      const approved = await Leave.countDocuments({ companyId, userId, status: { $regex: "^approved$", $options: "i" } });
      const rejected = await Leave.countDocuments({ companyId, userId, status: { $regex: "^rejected$", $options: "i" } });

      // For debugging, fetch the full leave records
      const allLeaves = await Leave.find({ companyId, userId });
      console.log("DEBUG - All leaves for employee:", allLeaves);

      console.log("DEBUG - Employee - Pending leaves count:", pending);
      console.log("DEBUG - Employee - Approved leaves count:", approved);
      console.log("DEBUG - Employee - Rejected leaves count:", rejected);

      response.leaveDetails = [
        { title: "Pending Leave", value: pending, icon: "faClock", bgColor: "bg-yellow-500" },
        { title: "Approved Leave", value: approved, icon: "faCheck", bgColor: "bg-green-500" },
        { title: "Rejected Leave", value: rejected, icon: "faTimes", bgColor: "bg-red-500" },
      ];
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized role" });
    }

    console.log("DEBUG - Response being sent:", response);
    return res.json(response);
  } catch (error) {
    console.error("Error fetching summary:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;