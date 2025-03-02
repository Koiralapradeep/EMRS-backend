import express from "express";
import Feedback from "../models/Feedback.js";
import Employee from "../models/Employee.js";
import {verifyUser} from "../middleware/authMiddleware.js";
import User from '../models/User.js';
const router = express.Router();

/**
 * @route POST /api/feedback
 * @desc Add Feedback - Employees can only add feedback for their own company
 */
router.post("/", verifyUser, async (req, res) => {
  try {
    const { accomplishments, challenges, suggestions, makePrivate, saveToDashboard } = req.body;

    if (!req.user.companyId) {
      return res.status(403).json({ success: false, error: "Unauthorized: No company assigned." });
    }

    // Get employee details (assuming department is stored in `User` model)
    const employee = await User.findById(req.user._id).select("department");

    const feedback = new Feedback({
      userId: req.user._id,
      companyId: req.user.companyId, 
      department: employee.department || "Unknown", 
      accomplishments,
      challenges,
      suggestions,
      makePrivate: Boolean(makePrivate),
      saveToDashboard: Boolean(saveToDashboard),
    });

    await feedback.save();
    console.log(" New Feedback Saved:", feedback);

    return res.status(201).json({ success: true, message: "Feedback added successfully.", feedback });
  } catch (error) {
    console.error(" Error adding feedback:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});



/**
 * @route GET /api/feedback
 * @desc Fetch only "saved" feedbacks for Employee Dashboard (saveToDashboard: true) - Employees can only see their own feedback
 */
router.get("/", verifyUser, async (req, res) => {
  try {
    if (!req.user || req.user.role !== "Employee") {
      console.log(">>> Unauthorized access to feedbacks:", req.user);
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    // Fetch only feedbacks from the logged-in employee
    const feedbacks = await Feedback.find({ userId: req.user._id, saveToDashboard: true }).sort({ createdAt: -1 });

    console.log(`>>> Fetching Feedback for Employee: ${req.user._id} - Found: ${feedbacks.length}`);
    return res.status(200).json({ success: true, feedbacks });
  } catch (error) {
    console.error(" Error fetching feedbacks:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route GET /api/feedback/manager
 * @desc Fetch all feedbacks for the Manager Dashboard with employee info masked if makePrivate is true
 */
router.get("/manager", verifyUser, async (req, res) => {
  try {
    console.log(`Fetching Feedback for Manager (Company ID: ${req.user.companyId})`);

    const feedbacks = await Feedback.find({ companyId: req.user.companyId })
      .populate({ path: "userId", select: "name email department" })
      .sort({ createdAt: -1 });

    console.log("Found Feedback:", feedbacks.length);

    const populatedFeedbacks = await Promise.all(
      feedbacks.map(async (feedback) => {
        const employee = await Employee.findOne({ userId: feedback.userId._id })
          .populate({ path: "department", select: "departmentName" })
          .lean();
        return {
          // Convert feedback to a plain object if it's a Mongoose document
          ...feedback.toObject ? feedback.toObject() : feedback,
          employeeID: employee?.employeeID || "N/A",
          department: employee?.department?.departmentName || "N/A",
        };
      })
    );

    return res.status(200).json({ success: true, feedbacks: populatedFeedbacks });
  } catch (error) {
    console.error("Error fetching manager feedback:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route DELETE /api/feedback/:id
 * @desc
 */
router.delete("/:id", verifyUser, async (req, res) => {
  try {
    const { id } = req.params;

    //  Find the feedback by its _id
    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: "Feedback not found.",
      });
    }

    // 
    if (!feedback.companyId || !req.user.companyId) {
      console.log(">>> FAIL: Missing companyId in either feedback or user.");
      return res.status(500).json({
        success: false,
        error: "companyId missing. Check DB data and user token.",
      });
    }

    if (feedback.companyId.toString() !== req.user.companyId) {
      console.log(">>> FAIL: Unauthorized delete attempt");
      return res.status(403).json({
        success: false,
        error: "Not authorized to delete this feedback.",
      });
    }

    // If it matches, delete the feedback
    await feedback.deleteOne();
    console.log(">>> SUCCESS: Feedback deleted");

    return res.status(200).json({
      success: true,
      message: "Feedback deleted successfully.",
      deletedId: id,
    });
  } catch (error) {
    console.error("Error deleting feedback:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});


export default router;
