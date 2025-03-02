import express from "express";
import Department from "../models/Department.js";
import { verifyUser } from "../middleware/authMiddleware.js"; // Import middleware

const router = express.Router();

/**
 * 🔹 Fetch all departments for the logged-in user's company
 */
router.get("/", verifyUser, async (req, res) => {
  try {
    // Use req.user.companyId instead of req.companyId
    const departments = await Department.find({ companyId: req.user.companyId });
    res.status(200).json(departments);
  } catch (error) {
    console.error("Error fetching departments:", error.message);
    res.status(500).json({ error: "Failed to fetch departments." });
  }
});

/**
 * 🔹 Fetch a single department by ID (Ensure it belongs to the logged-in user's company)
 */
router.get("/:id", verifyUser, async (req, res) => {
  try {
    console.log("DEBUG - Fetching department for ID:", req.params.id);

    const department = await Department.findOne({ 
      _id: req.params.id, 
      companyId: req.user.companyId 
    });

    if (!department) {
      console.error("ERROR - Department not found or unauthorized");
      return res.status(404).json({ error: "Department not found or unauthorized." });
    }

    res.status(200).json(department);
  } catch (error) {
    console.error("Error fetching department:", error.message);
    res.status(500).json({ error: "Failed to fetch department." });
  }
});

/**
 * 🔹 Add a new department (Ensuring it is assigned to the correct company)
 */
router.post("/", verifyUser, async (req, res) => {
  const { departmentName, departmentCode, description } = req.body;
  const companyId = req.user.companyId; // Use req.user.companyId

  if (!departmentName || !departmentCode) {
    return res.status(400).json({ error: "Department name and code are required." });
  }

  try {
    const existingDepartment = await Department.findOne({ departmentCode, companyId });
    if (existingDepartment) {
      return res.status(400).json({ error: "Department code already exists in your company." });
    }

    const newDepartment = new Department({ departmentName, departmentCode, description, companyId });
    await newDepartment.save();

    res.status(201).json(newDepartment);
  } catch (error) {
    console.error("Error adding department:", error.message);
    res.status(500).json({ error: "Failed to add department." });
  }
});

/**
 * 🔹 Update a department (Ensure the department belongs to the logged-in user's company)
 */
router.put("/:id", verifyUser, async (req, res) => {
  const { departmentName, departmentCode, description } = req.body;

  if (!departmentName || !departmentCode) {
    return res.status(400).json({ error: "Department name and code are required." });
  }

  try {
    const department = await Department.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId }, // Ensure company restriction
      { departmentName, departmentCode, description },
      { new: true }
    );

    if (!department) {
      return res.status(404).json({ error: "Department not found or unauthorized." });
    }

    res.status(200).json(department);
  } catch (error) {
    console.error("Error updating department:", error.message);
    res.status(500).json({ error: "Failed to update department." });
  }
});

/**
 * 🔹 Delete a department (Ensure it belongs to the logged-in user's company)
 */
router.delete("/:id", verifyUser, async (req, res) => {
  try {
    const deletedDepartment = await Department.findOneAndDelete({
      _id: req.params.id,
      companyId: req.user.companyId, // Use req.user.companyId
    });

    if (!deletedDepartment) {
      return res.status(404).json({ error: "Department not found or unauthorized." });
    }

    res.status(200).json({ message: "Department deleted successfully." });
  } catch (error) {
    console.error("Error deleting department:", error.message);
    res.status(500).json({ error: "Failed to delete department." });
  }
});

export default router;
