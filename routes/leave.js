import express from "express";
import mongoose from "mongoose";
import Leave from "../models/Leave.js";
import Employee from "../models/Employee.js";
import { verifyUser } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * @route 
 * @desc    Add a new leave request (Employee only)
 */
router.post("/add", verifyUser, async (req, res) => {
  try {
    const { leaveType, fromDate, toDate, description } = req.body;

    // Required fields validation
    if (!leaveType || !fromDate || !toDate || !description) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    // Only employees can add leave requests
    if (req.user.role !== "Employee") {
      return res.status(403).json({ success: false, error: "Only employees can add leave requests." });
    }

    // Employee must have a companyId
    if (!req.user.companyId) {
      return res.status(403).json({ success: false, error: "You are not assigned to a company." });
    }

    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ success: false, error: "Invalid date format." });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date." });
    }
    if (startDate < todayMidnight) {
      return res.status(400).json({ success: false, error: "Cannot apply for past dates." });
    }

    // Check for duplicate exact date range
    const duplicateLeave = await Leave.findOne({
      userId: req.user._id,
      fromDate: startDate,
      toDate: endDate,
    });
    if (duplicateLeave) {
      return res.status(400).json({
        success: false,
        error: "You have already applied for leave on these dates.",
      });
    }

    // Check for overlapping dates
    const overlappingLeave = await Leave.findOne({
      userId: req.user._id,
      $or: [{ fromDate: { $lte: endDate }, toDate: { $gte: startDate } }],
    });
    if (overlappingLeave) {
      return res.status(400).json({
        success: false,
        error: `You already have a leave request for ${new Date(
          overlappingLeave.fromDate
        ).toLocaleDateString()} to ${new Date(
          overlappingLeave.toDate
        ).toLocaleDateString()}.`,
      });
    }

    const newLeave = new Leave({
      userId: req.user._id,
      companyId: req.user.companyId,
      leaveType,
      fromDate: startDate,
      toDate: endDate,
      description,
      status: "Pending",
      appliedDate: new Date(),
    });

    const savedLeave = await newLeave.save();
    return res.status(201).json({
      success: true,
      message: "Leave request added successfully.",
      leave: savedLeave,
    });
  } catch (error) {
    console.error("Error adding leave request:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route   GET /api/leave
 * @desc    Fetch leaves:
 */
router.get("/", verifyUser, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === "Manager") {
      query.companyId = req.user.companyId;
    } else if (req.user.role === "Employee") {
      query.userId = req.user._id;
    }

    const leaves = await Leave.find(query)
      .populate({ path: "userId", select: "name" })
      .lean();

    // Attach additional employee details
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

    return res.status(200).json({ success: true, leaves: populatedLeaves });
  } catch (error) {
    console.error("Error fetching leaves:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route   GET /api/leave/:id
 * @desc    Fetch single leave with extra employee details
 */
router.get("/:id", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the leave ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid leave ID format.",
      });
    }

    // Find the leave by ID
    const leave = await Leave.findById(id)
      .populate({ path: "userId", select: "name email" })
      .lean();

    if (!leave) {
      return res.status(404).json({
        success: false,
        error: "Leave request not found.",
      });
    }

    // If manager, must match manager's company
    if (req.user.role === "Manager") {
      if (!leave.companyId || leave.companyId.toString() !== req.user.companyId) {
        return res.status(403).json({
          success: false,
          error: "Unauthorized to view this leave.",
        });
      }
    }

    // If employee, must own the leave
    if (req.user.role === "Employee") {
      if (leave.userId._id.toString() !== req.user._id) {
        return res.status(403).json({
          success: false,
          error: "Unauthorized to view this leave.",
        });
      }
    }

    // Attach extra employee details
    const employee = await Employee.findOne({ userId: leave.userId._id })
      .populate({ path: "department", select: "departmentName" })
      .lean();

    const finalLeave = {
      ...leave,
      employeeID: employee?.employeeID || "N/A",
      department: employee?.department?.departmentName || "N/A",
    };

    return res.status(200).json({ success: true, leave: finalLeave });
  } catch (error) {
    console.error("Error fetching single leave:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * ROUTE B: Fetch ALL leaves for a single employee
 * GET /api/leave/employee/:employeeId
 */
router.get("/employee/:employeeId", verifyUser, async (req, res) => {
  try {
    const { employeeId } = req.params;

    // Validate employeeId format if needed (optional)
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID format.",
      });
    }

    // Retrieve leaves for the specified employee and the manager's company
    const leaves = await Leave.find({
      userId: employeeId,
      companyId: req.user.companyId,
    }).lean();

    // Instead of an error when no leaves are found, return a success with an empty array
    if (!leaves || leaves.length === 0) {
      return res.status(200).json({
        success: true,
        leaves: [],
        message: "No leaves found for this employee.",
      });
    }

    return res.status(200).json({ success: true, leaves });
  } catch (error) {
    console.error("Error fetching employee leaves:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});


/**
 * @route   PUT /api/leave/:id/status
 * @desc    Approve/Reject a leave (Manager only)
 */
router.put("/:id/status", verifyUser, async (req, res) => {
  try {
    console.log(">>> PUT /api/leave/:id/status triggered");
    const { id } = req.params;
    const { status } = req.body;

    console.log(">>> ID:", id, " Status:", status);
    console.log(">>> req.user:", req.user);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid leave ID format." });
    }
    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid leave status." });
    }

    const leave = await Leave.findById(id);
    console.log(">>> Found leave:", leave);

    if (!leave) {
      return res.status(404).json({ success: false, error: "Leave request not found." });
    }

    // Must be manager
    if (req.user.role !== "Manager") {
      console.log(">>> FAIL: Not manager, role:", req.user.role);
      return res.status(403).json({ success: false, error: "Only managers can update leave status." });
    }

    // Debug logs for company
    console.log(">>> leave.companyId:", leave.companyId);
    console.log(">>> req.user.companyId:", req.user.companyId);

    // Ensure companyId exists in both objects
    if (!leave.companyId || !req.user.companyId) {
      console.log(">>> FAIL: One of them is missing, returning 500 to avoid crash");
      return res.status(500).json({ success: false, error: "companyId missing. Check server logs and DB data." });
    }

    // Compare company IDs as strings
    if (leave.companyId.toString() !== req.user.companyId.toString()) {
      console.log(">>> FAIL: Company ID mismatch", leave.companyId.toString(), req.user.companyId.toString());
      return res.status(403).json({ success: false, error: "Unauthorized to modify this leave." });
    }

    // If all is good, update status
    leave.status = status;
    await leave.save();
    console.log(">>> SUCCESS: Updated status to", status);

    return res.status(200).json({
      success: true,
      message: `Leave status updated to ${status}.`,
      leave,
    });
  } catch (error) {
    console.error("Error updating leave status:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route   DELETE /api/leave/:id
 * @desc    Delete a leave (Manager or owner Employee)
 */
router.delete("/:id", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid leave ID format." });
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, error: "Leave not found." });
    }

    console.log(">>> leave.companyId:", leave.companyId);
    console.log(">>> req.user.companyId:", req.user.companyId);

    // Ensure companyId exists in both objects
    if (!leave.companyId || !req.user.companyId) {
      console.log(">>> FAIL: One of them is missing, returning 500 to avoid crash");
      return res.status(500).json({ success: false, error: "companyId missing. Check server logs and DB data." });
    }

    // Manager can delete if leave belongs to same company
    if (req.user.role === "Manager") {
      if (leave.companyId.toString() !== req.user.companyId.toString()) {
        console.log(">>> FAIL: Manager unauthorized to delete this leave");
        return res.status(403).json({ success: false, error: "Not authorized to delete this leave." });
      }
    }

    // Employee can delete only if they own the leave
    if (req.user.role === "Employee") {
      if (leave.userId.toString() !== req.user._id.toString()) {
        console.log(">>> FAIL: Employee unauthorized to delete this leave");
        return res.status(403).json({ success: false, error: "Not authorized to delete this leave." });
      }
    }

    await leave.deleteOne();
    console.log(">>> SUCCESS: Leave deleted");
    return res.status(200).json({ success: true, message: "Leave deleted successfully." });
  } catch (error) {
    console.error("Error deleting leave:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

export default router;
