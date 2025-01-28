import express from "express";
import Leave from "../models/Leave.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import mongoose from "mongoose";

const router = express.Router();

/**
 * @route GET /api/leavegit stash list

 * @desc Fetch all leave requests or specific user's leave requests
 */
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

    // Fetch leave requests and populate user details
    const leaves = await Leave.find(userId ? { userId } : {})
      .populate({
        path: "userId",
        select: "name",
      })
      .lean();

    // Fetch Employee details separately
    for (let leave of leaves) {
      const employee = await Employee.findOne({ userId: leave.userId?._id })
        .populate({
          path: "department",
          select: "departmentName",
        })
        .lean();

      // Attach Employee ID, Department, Name, and Applied Date
      leave.empId = employee?.employeeID || "N/A";
      leave.department = employee?.department?.departmentName || "N/A";
      leave.name = leave.userId?.name || "N/A";

      // 🛠 FIX: Ensure status is always set (default to "Pending")
      leave.status = leave.status || "Pending";

      // 🛠 FIX: Set appliedDate from createdAt (leave request submission date)
      leave.appliedDate = leave.createdAt ? new Date(leave.createdAt).toISOString() : "N/A";
    }

    console.log("✅ Debug: Populated Leaves Data:", JSON.stringify(leaves, null, 2));

    res.status(200).json({ success: true, leaves });
  } catch (error) {
    console.error("❌ Error fetching leaves:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route POST /api/leave/add
 * @desc Add a new leave request by an employee
 */
router.post("/add", async (req, res) => {
  try {
    const { userId, leaveType, fromDate, toDate, description } = req.body;

    // Validate request body
    if (!userId || !leaveType || !fromDate || !toDate || !description) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    // Validate dates
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    if (isNaN(startDate) || isNaN(endDate) || startDate > endDate) {
      return res.status(400).json({ success: false, error: "Invalid date range." });
    }

    // Create a new leave request with default status as Pending
    const newLeave = new Leave({
      userId,
      leaveType,
      fromDate: startDate,
      toDate: endDate,
      description,
      status: "Pending",
    });

    const savedLeave = await newLeave.save();

    res.status(201).json({
      success: true,
      message: "Leave request added successfully.",
      leave: savedLeave,
    });
  } catch (error) {
    console.error("❌ Error adding leave request:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

export default router;
