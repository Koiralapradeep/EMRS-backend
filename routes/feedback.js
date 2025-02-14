import express from "express";
import Feedback from "../models/Feedback.js";
<<<<<<< HEAD
import User from "../models/User.js"; 
import Employee from "../models/Employee.js"; 


const router = express.Router();

// POST: Add Feedback
router.post("/", async (req, res) => {
  try {
    const { userId, accomplishments, challenges, suggestions } = req.body;
=======
import Employee from "../models/Employee.js";

const router = express.Router();

/**
 * @route POST /api/feedback
 * @desc Add Feedback and store makePrivate & saveToDashboard flags
 */
router.post("/", async (req, res) => {
  try {
    // Destructure with new keys from the request body
    const { userId, accomplishments, challenges, suggestions, makePrivate, saveToDashboard } = req.body;
>>>>>>> development

    if (!userId || !accomplishments || !challenges || !suggestions) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

<<<<<<< HEAD
    const feedback = new Feedback({ userId, accomplishments, challenges, suggestions });
    await feedback.save();
=======
    const feedback = new Feedback({
      userId,
      accomplishments,
      challenges,
      suggestions,
      makePrivate: Boolean(makePrivate),
      saveToDashboard: Boolean(saveToDashboard),
    });

    await feedback.save();
    console.log("🟢 New Feedback Saved:", feedback);
>>>>>>> development

    return res.status(201).json({
      success: true,
      message: "Feedback added successfully.",
      feedback,
    });
  } catch (error) {
<<<<<<< HEAD
    console.error("Error adding feedback:", error);
=======
    console.error("❌ Error adding feedback:", error);
>>>>>>> development
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

<<<<<<< HEAD
// GET: Fetch Feedbacks for a Specific User
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

=======
/**
 * @route GET /api/feedback
 * @desc Fetch only "saved" feedbacks for Employee Dashboard (saveToDashboard: true)
 */
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
>>>>>>> development
    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required." });
    }

<<<<<<< HEAD
    const feedbacks = await Feedback.find({ userId }).sort({ createdAt: -1 });

    return res.status(200).json({ success: true, feedbacks });
  } catch (error) {
    console.error("Error fetching feedbacks:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});
router.get("/manager", async (req, res) => {
  try {
    const feedbacks = await Feedback.find()
      .populate({
        path: "userId",
        select: "name email",
      })
      .sort({ createdAt: -1 });

    const populatedFeedbacks = await Promise.all(
      feedbacks.map(async (feedback) => {
        const employee = await Employee.findOne({ userId: feedback.userId._id })
=======
    // Only return feedback that should be permanently saved on the Employee Dashboard
    const feedbacks = await Feedback.find({ userId, saveToDashboard: true }).sort({ createdAt: -1 });
    console.log(`🟢 Fetching Feedback for User: ${userId} - Found: ${feedbacks.length}`);

    return res.status(200).json({ success: true, feedbacks });
  } catch (error) {
    console.error("❌ Error fetching feedbacks:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route GET /api/feedback/manager
 * @desc Fetch all feedbacks for the Manager Dashboard with employee info masked if makePrivate is true
 */
router.get("/manager", async (req, res) => {
  try {
    console.log("🟢 Fetching Feedback for Manager...");

    // Populate the userId field so we have name/email information
    const feedbacks = await Feedback.find()
      .populate({ path: "userId", select: "name email" })
      .sort({ createdAt: -1 });

    console.log("🟢 All Feedbacks Retrieved:", feedbacks.length);

    // For each feedback, fetch the associated employee and mask info if makePrivate is true
    const populatedFeedbacks = await Promise.all(
      feedbacks.map(async (feedback) => {
        const employeeId = feedback.userId?._id || feedback.userId;
        const employee = await Employee.findOne({ userId: employeeId })
>>>>>>> development
          .populate("department", "departmentName")
          .lean();

        return {
          ...feedback.toObject(),
<<<<<<< HEAD
          employeeID: employee?.employeeID || "N/A",
          department: employee?.department?.departmentName || "N/A",
=======
          employeeID: feedback.makePrivate ? "Unknown" : (employee?.employeeID || "N/A"),
          department: feedback.makePrivate ? "Unknown" : (employee?.department?.departmentName || "Not Assigned"),
>>>>>>> development
        };
      })
    );

<<<<<<< HEAD
    res.status(200).json({ success: true, feedbacks: populatedFeedbacks });
  } catch (error) {
    console.error("Error fetching feedbacks:", error.message, error.stack);
    res.status(500).json({ success: false, error: "Internal Server Error." });
=======
    console.log(`🟢 Final API Response: ${populatedFeedbacks.length} Feedbacks`);
    return res.status(200).json({ success: true, feedbacks: populatedFeedbacks });
  } catch (error) {
    console.error("❌ Error fetching feedbacks:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route DELETE /api/feedback/:id
 * @desc Delete a feedback by ID
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const feedback = await Feedback.findByIdAndDelete(id);

    if (!feedback) {
      return res.status(404).json({ success: false, message: "Feedback not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Feedback deleted successfully.",
      deletedId: id,
    });
  } catch (error) {
    console.error("❌ Error deleting feedback:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
>>>>>>> development
  }
});


<<<<<<< HEAD
 
  
  
  

=======
>>>>>>> development
export default router;
