import express from "express";
import Feedback from "../models/Feedback.js";
import User from "../models/User.js"; 
import Employee from "../models/Employee.js"; 


const router = express.Router();

// POST: Add Feedback
router.post("/", async (req, res) => {
  try {
    const { userId, accomplishments, challenges, suggestions } = req.body;

    if (!userId || !accomplishments || !challenges || !suggestions) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    const feedback = new Feedback({ userId, accomplishments, challenges, suggestions });
    await feedback.save();

    return res.status(201).json({
      success: true,
      message: "Feedback added successfully.",
      feedback,
    });
  } catch (error) {
    console.error("Error adding feedback:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// GET: Fetch Feedbacks for a Specific User
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required." });
    }

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
          .populate("department", "departmentName")
          .lean();

        return {
          ...feedback.toObject(),
          employeeID: employee?.employeeID || "N/A",
          department: employee?.department?.departmentName || "N/A",
        };
      })
    );

    res.status(200).json({ success: true, feedbacks: populatedFeedbacks });
  } catch (error) {
    console.error("Error fetching feedbacks:", error.message, error.stack);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});


 
  
  
  

export default router;
