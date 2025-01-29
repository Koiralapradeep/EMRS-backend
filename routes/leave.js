import express from "express";
import Leave from "../models/Leave.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import mongoose from "mongoose";

const router = express.Router();

/**
 * @route GET /api/leave
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

// Update leave status by leave ID
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    // Validate inputs
    if (!id || !status) {
      return res.status(400).json({ success: false, message: "Missing leave ID or status" });
    }

    // Find the leave by ID
    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave not found" });
    }

    // Update the status
    leave.status = status;
    await leave.save();

    res.status(200).json({ success: true, message: `Leave status updated to ${status}` });
  } catch (error) {
    console.error("Error updating leave status:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: "No user ID provided." });
    }

    // Find leave requests for the specific user
    const leaves = await Leave.find({ userId })
      .populate({ path: "userId", select: "name" })
      .lean();

    if (leaves.length === 0) {
      return res.status(404).json({ success: false, error: "No leave requests found for this employee." });
    }

    res.status(200).json({ success: true, leaves });
  } catch (error) {
    console.error("Error fetching leave requests:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});



export default router;
