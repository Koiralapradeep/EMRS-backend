import express from "express";
import mongoose from "mongoose";
import Leave from "../models/Leave.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";

const router = express.Router();

/**
 * @route POST /api/leave/add
 * @desc Add a new leave request by an employee
 */
router.post("/add", async (req, res) => {
  try {
    const { userId, leaveType, fromDate, toDate, description } = req.body;

    if (!userId || !leaveType || !fromDate || !toDate || !description) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, error: "Invalid user ID format." });
    }

    const userExists = await User.findById(userId);
    if (!userExists) {
      return res.status(404).json({ success: false, error: "User does not exist." });
    }

    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    const today = new Date();

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ success: false, error: "Invalid date format." });
    }

    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date." });
    }

    if (startDate < today.setHours(0, 0, 0, 0)) {
      return res.status(400).json({ success: false, error: "Leave cannot be applied for past dates." });
    }

    const overlappingLeave = await Leave.findOne({
      userId,
      $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }],
    });

    if (overlappingLeave) {
      return res.status(400).json({
        success: false,
        error: `You already have a leave request for ${new Date(
          overlappingLeave.fromDate
        ).toLocaleDateString()} to ${new Date(overlappingLeave.toDate).toLocaleDateString()}.`,
      });
    }

    const newLeave = new Leave({
      userId,
      leaveType,
      fromDate: startDate,
      toDate: endDate,
      description,
      status: "Pending",
      appliedDate: new Date(),
    });

    const savedLeave = await newLeave.save();
    res.status(201).json({ success: true, message: "Leave request added successfully.", leave: savedLeave });
  } catch (error) {
    console.error("❌ Error adding leave request:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route GET /api/leave
 * @desc Fetch all leave requests with optional filters (name, department) or individual employee leaves
 */
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

    let query = {};
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, error: "Invalid user ID format." });
      }
      query.userId = userId;
    }

    const leaves = await Leave.find(query)
      .populate({ path: "userId", select: "name" })
      .lean();

    const populatedLeaves = await Promise.all(
      leaves.map(async (leave) => {
        const employee = await Employee.findOne({ userId: leave.userId._id })
          .populate({ path: "department", select: "departmentName" })
          .lean();

        return {
          ...leave,
          employeeID: employee?.employeeID || "N/A",
          department: employee?.department?.departmentName || "N/A",
        };
      })
    );

    if (!populatedLeaves || populatedLeaves.length === 0) {
      return res.status(404).json({ success: false, error: "No leave requests found." });
    }

    res.status(200).json({ success: true, leaves: populatedLeaves });
  } catch (error) {
    console.error("Error fetching leaves:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});


/**
 * @route PUT /api/leave/:id/status
 * @desc Update leave request status
 */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid leave ID format." });
    }

    if (!status) {
      return res.status(400).json({ success: false, error: "Status is required." });
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, error: "Leave request not found." });
    }

    leave.status = status;
    await leave.save();

    res.status(200).json({ success: true, message: `Leave status updated to ${status}.`, leave });
  } catch (error) {
    console.error("❌ Error updating leave status:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// DELETE route to remove a leave request by its ID
router.delete('/:id', async (req, res) => {
  const leaveId = req.params.id;

  try {
    // Find and delete the leave from the database by ID
    const deletedLeave = await Leave.findByIdAndDelete(leaveId);

    // If the leave wasn't found
    if (!deletedLeave) {
      return res.status(404).json({ success: false, message: 'Leave not found.' });
    }

    // If deletion was successful, send success response
    return res.status(200).json({ success: true, message: 'Leave deleted successfully.' });
  } catch (error) {
    console.error('Error deleting leave:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});
export default router;
