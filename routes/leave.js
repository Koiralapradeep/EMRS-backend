import express from "express";
import mongoose from "mongoose";
import Leave from "../models/Leave.js";
import Employee from "../models/Employee.js";
import { verifyUser } from "../middleware/authMiddleware.js";
import Notification from "../models/Notifications.js";
import User from "../models/User.js";

const router = express.Router();

/**
 * @route POST /api/leave/add
 * @desc Add a new leave request (Employee only)
 */
router.post("/add", verifyUser, async (req, res) => {
  try {
    console.log("Received leave request:", req.body);
    console.log("Authenticated user:", req.user);

    const { leaveType, fromDate, toDate, description } = req.body;

    // Validate required fields
    if (!leaveType || !fromDate || !toDate || !description) {
      console.log("Validation failed: Missing required fields");
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    // Check user role
    if (req.user.role !== "Employee") {
      console.log("Authorization failed: User is not an Employee");
      return res.status(403).json({ success: false, error: "Only employees can add leave requests." });
    }

    // Check company assignment
    if (!req.user.companyId) {
      console.log("Authorization failed: No companyId for user");
      return res.status(403).json({ success: false, error: "You are not assigned to a company." });
    }

    // Parse and validate dates
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    if (isNaN(startDate) || isNaN(endDate)) {
      console.log("Validation failed: Invalid date format");
      return res.status(400).json({ success: false, error: "Invalid date format." });
    }

    if (startDate > endDate) {
      console.log("Validation failed: Start date after end date");
      return res.status(400).json({ success: false, error: "Start date cannot be after end date." });
    }
    if (startDate < todayMidnight) {
      console.log("Validation failed: Past date requested");
      return res.status(400).json({ success: false, error: "Cannot apply for past dates." });
    }

    // Check for duplicate leave requests
    console.log("Checking for existing leave...");
    const existingLeave = await Leave.findOne({
      userId: req.user._id,
      companyId: req.user.companyId,
      $or: [
        { fromDate: { $lte: endDate }, toDate: { $gte: startDate } },
        { fromDate: startDate, toDate: endDate },
      ],
    });
    if (existingLeave) {
      console.log("Validation failed: Duplicate leave found", existingLeave);
      return res.status(400).json({ success: false, error: "You already have a leave request for these dates." });
    }

    // Create and save leave request
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

    console.log("Attempting to save leave:", newLeave);
    const savedLeave = await newLeave.save();
    console.log("Leave saved successfully:", savedLeave);

    // Fetch employee name from req.user (already available)
    const employeeName = req.user.name || "Employee";
    console.log("Employee name:", employeeName);

    // Fetch manager from User model
    console.log("Fetching manager for companyId:", req.user.companyId);
    const manager = await User.findOne({ role: "Manager", companyId: req.user.companyId });
    if (!manager) {
      console.log("No manager found for companyId:", req.user.companyId);
      return res.status(201).json({
        success: true,
        message: "Leave request added, but no manager found to notify.",
        leave: savedLeave,
      });
    }
    console.log("Manager found:", manager);

    // Create and save notification with detailed message
    const notification = new Notification({
      recipient: manager._id,
      sender: req.user._id,
      type: "leave_request",
      message: `${employeeName} has submitted a ${leaveType} leave request from ${fromDate} to ${toDate}.`,
      leaveId: savedLeave._id, // Add leaveId to link the notification to the leave request
      isRead: false,
    });

    console.log("Attempting to save notification:", notification);
    const savedNotification = await notification.save();
    console.log("Notification saved:", savedNotification);

    // Ensure all ObjectIds are converted to strings for frontend compatibility
    const notificationPayload = {
      ...savedNotification.toObject(),
      _id: savedNotification._id.toString(),
      recipient: savedNotification.recipient.toString(),
      sender: savedNotification.sender.toString(),
      leaveId: savedNotification.leaveId.toString(), // Convert leaveId to string
    };

    // Send notification
    console.log("Sending notification to manager:", manager._id);
    await sendNotification(manager._id.toString(), notificationPayload);
    console.log("Notification sent successfully to manager:", manager._id);

    return res.status(201).json({
      success: true,
      message: "Leave request added successfully.",
      leave: savedLeave,
    });
  } catch (error) {
    console.error("Error in POST /api/leave/add:", error.stack);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error.",
      details: error.message,
    });
  }
});
/**
 * @route GET /api/leave/:id
 * @desc Fetch single leave with extra employee details
 */
router.get("/:id", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Fetching leave with ID:", id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid leave ID format." });
    }

    const leave = await Leave.findById(id)
      .populate({ path: "userId", select: "name email" })
      .lean();

    console.log("Fetched leave:", leave);

    if (!leave) {
      return res.status(404).json({ success: false, error: "Leave request not found." });
    }

    console.log("User role:", req.user.role);
    console.log("Leave companyId:", leave.companyId, "User companyId:", req.user.companyId);
    console.log("Leave userId:", leave.userId._id, "User _id:", req.user._id);

    if (req.user.role === "Manager") {
      if (!leave.companyId || leave.companyId.toString() !== req.user.companyId.toString()) {
        return res.status(403).json({ success: false, error: "Unauthorized to view this leave." });
      }
    }

    if (req.user.role === "Employee") {
      if (leave.userId._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, error: "Unauthorized to view this leave." });
      }
    }

    const employee = await Employee.findOne({ userId: leave.userId._id })
      .populate({ path: "department", select: "departmentName" })
      .lean();

    console.log("Fetched employee for leave:", employee);

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
 * @route GET /api/leave/employee/:employeeId
 * @desc Fetch all leaves for a single employee
 */
router.get("/employee/:employeeId", verifyUser, async (req, res) => {
  try {
    const { employeeId } = req.params;

    console.log("Request received for GET /api/leave/employee/:employeeId");
    console.log("EmployeeId from params:", employeeId);
    console.log("User details from middleware:", req.user);

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log("Invalid employee ID format:", employeeId);
      return res.status(400).json({ success: false, error: "Invalid employee ID format." });
    }

    console.log("Fetching leaves for employeeId:", employeeId, "with companyId:", req.user.companyId);

    const leaves = await Leave.find({
      userId: employeeId,
      companyId: req.user.companyId,
    }).lean();

    console.log("Fetched leaves:", leaves);

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
 * @route GET /api/leave/company/:companyId
 * @desc Fetch all leaves for a company (Manager only)
 */
router.get("/company/:companyId", verifyUser, async (req, res) => {
  try {
    const { companyId } = req.params;

    console.log("Fetching leaves for companyId:", companyId);
    console.log("User details:", req.user);

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: "Invalid company ID format." });
    }

    if (req.user.role !== "Manager") {
      return res.status(403).json({ success: false, error: "Only managers can view company leaves." });
    }

    if (companyId !== req.user.companyId) {
      return res.status(403).json({ success: false, error: "Unauthorized to view leaves for this company." });
    }

    const leaves = await Leave.find({ companyId })
      .populate({ path: "userId", select: "name email" })
      .lean();

    console.log("Fetched company leaves:", leaves);

    if (!leaves || leaves.length === 0) {
      return res.status(200).json({
        success: true,
        leaves: [],
        message: "No leaves found for this company.",
      });
    }

    const leavesWithEmployeeDetails = await Promise.all(
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

    return res.status(200).json({ success: true, leaves: leavesWithEmployeeDetails });
  } catch (error) {
    console.error("Error fetching company leaves:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route PUT /api/leave/:id/status
 * @desc Approve/Reject a leave (Manager only)
 */
router.put("/:id/status", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid leave ID format." });
    }

    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid leave status." });
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, error: "Leave request not found." });
    }

    if (req.user.role !== "Manager") {
      return res.status(403).json({ success: false, error: "Only managers can update leave status." });
    }

    leave.status = status;
    await leave.save();

    // Fetch manager name
    const manager = await User.findById(req.user._id);
    const managerName = manager ? manager.name : "your manager";

    // Create notification with detailed message
    const notification = new Notification({
      recipient: leave.userId.toString(),
      sender: req.user._id,
      type: status === "Approved" ? "leave_approved" : "leave_rejected",
      message: `Your ${leave.leaveType} leave request from ${leave.fromDate.toISOString().split("T")[0]} to ${leave.toDate.toISOString().split("T")[0]} has been ${status.toLowerCase()} by ${managerName}.`,
      isRead: false,
    });

    await notification.save();

    // Ensure all ObjectIds are converted to strings for frontend compatibility
    const notificationPayload = {
      ...notification.toObject(),
      _id: notification._id.toString(),
      recipient: notification.recipient.toString(),
      sender: notification.sender.toString(),
    };

    await sendNotification(leave.userId.toString(), notificationPayload);

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
 * @route DELETE /api/leave/:id
 * @desc Delete a leave (Manager or owner Employee)
 */
router.delete("/:id", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Deleting leave with ID:", id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid leave ID format." });
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ success: false, error: "Leave not found." });
    }

    console.log("Leave companyId:", leave.companyId);
    console.log("User companyId:", req.user.companyId);

    if (!leave.companyId || !req.user.companyId) {
      console.log("FAIL: companyId missing in leave or user");
      return res.status(500).json({ success: false, error: "companyId missing. Check server logs and DB data." });
    }

    if (req.user.role === "Manager") {
      if (leave.companyId.toString() !== req.user.companyId.toString()) {
        console.log("FAIL: Manager unauthorized to delete this leave");
        return res.status(403).json({ success: false, error: "Not authorized to delete this leave." });
      }
    }

    if (req.user.role === "Employee") {
      if (leave.userId.toString() !== req.user._id.toString()) {
        console.log("FAIL: Employee unauthorized to delete this leave");
        return res.status(403).json({ success: false, error: "Not authorized to delete this leave." });
      }
    }

    await leave.deleteOne();
    console.log("SUCCESS: Leave deleted");
    return res.status(200).json({ success: true, message: "Leave deleted successfully." });
  } catch (error) {
    console.error("Error deleting leave:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

export default router;