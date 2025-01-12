import express from "express";
import multer from "multer";
import path from "path";
import Employee from "../models/Employee.js";

const router = express.Router();

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Add a new employee
router.post("/add", upload.single("image"), async (req, res) => {
  try {
    console.log("Request body:", req.body);
    console.log("Uploaded file:", req.file);

    const {
      fullName,
      email,
      employeeID,
      dob,
      gender,
      maritalStatus,
      designation,
      department,
      role,
    } = req.body;

    // Validate required fields
    if (
      !fullName ||
      !email ||
      !employeeID ||
      !dob ||
      !gender ||
      !maritalStatus ||
      !designation ||
      !department ||
      !role
    ) {
      return res.status(400).json({
        success: false,
        error: "All required fields must be provided.",
      });
    }

    const newEmployee = new Employee({
      userId: "63e8f0b9f6e2eec84bfc47d1", // Placeholder ObjectId
      fullName,
      email,
      employeeID,
      dob: new Date(dob),
      gender,
      maritalStatus,
      designation,
      department,
      role,
      image: req.file?.filename,
    });

    await newEmployee.save();
    res.status(201).json({ success: true, message: "Employee added successfully!" });
  } catch (error) {
    console.error("Error adding employee:", error.message, error.stack);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Duplicate email or employeeID.",
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch all employees
router.get("/", async (req, res) => {
  try {
    const employees = await Employee.find().populate("department", "departmentName");
    res.status(200).json({ success: true, employees });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({ success: false, error: "Failed to fetch employees." });
  }
});

// Fetch a single employee by ID
router.get("/:id", async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id).populate("department", "departmentName");
    if (!employee) {
      return res.status(404).json({ success: false, error: "Employee not found." });
    }
    res.status(200).json({ success: true, employee });
  } catch (error) {
    console.error("Error fetching employee:", error);
    res.status(500).json({ success: false, error: "Failed to fetch employee." });
  }
});

// Update an employee by ID
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;

    const {
      fullName,
      email,
      employeeID,
      dob,
      gender,
      maritalStatus,
      designation,
      department,
      role,
    } = req.body;

    const updateData = {
      fullName,
      email,
      employeeID,
      dob: dob ? new Date(dob) : undefined,
      gender,
      maritalStatus,
      designation,
      department,
      role,
    };

    if (req.file) {
      updateData.image = req.file.filename;
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedEmployee) {
      return res.status(404).json({ success: false, error: "Employee not found." });
    }

    res.status(200).json({ success: true, message: "Employee updated successfully!", employee: updatedEmployee });
  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

// Delete an employee by ID
router.delete("/:id", async (req, res) => {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, error: "Employee not found." });
    }
    res.status(200).json({ success: true, message: "Employee deleted successfully." });
  } catch (error) {
    console.error("Error deleting employee:", error);
    res.status(500).json({ success: false, error: "Failed to delete employee." });
  }
});

export default router;
