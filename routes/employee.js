import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import path from "path";
import bcrypt from "bcrypt";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import { verifyUser } from "../middleware/authMiddleware.js";

const router = express.Router();

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

/**
 * @route   POST /api/employee/add
 * @desc    Add a new employee (Manager only) - role defaults to "Employee"
 */
router.post("/add", verifyUser, upload.single("image"), async (req, res) => {
  try {
    const {
      fullName,
      email,
      employeeID,
      dob,
      gender,
      maritalStatus,
      designation,
      department,
      password,
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
      !password
    ) {
      return res.status(400).json({
        success: false,
        error: "All fields are required (except role).",
      });
    }

    // Check if user is truly a Manager (optional check):
    // if (req.user.role !== "Manager") {
    //   return res.status(403).json({
    //     success: false,
    //     error: "Only managers can add employees.",
    //   });
    // }

    // Manager must have a valid companyId
    if (!req.user.companyId) {
      return res.status(403).json({
        success: false,
        error: "Access Denied: Manager does not belong to a company.",
      });
    }

    // Ensure email is unique
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User with this email already exists.",
      });
    }

    // Hash password for new user
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user document with role = "Employee"
    const newUser = new User({
      name: fullName,
      email,
      password: hashedPassword,
      role: "Employee",
      companyId: req.user.companyId, // stored as a string
    });
    const savedUser = await newUser.save();

    // Create a new employee document linked to that user
    const newEmployee = new Employee({
      userId: savedUser._id,
      employeeID,
      fullName,
      email,
      dob,
      gender,
      maritalStatus,
      designation,
      department,
      companyId: req.user.companyId, // also stored as a string
      image: req.file ? req.file.filename : null,
    });
    await newEmployee.save();

    return res.status(201).json({
      success: true,
      message: "Employee added successfully!",
    });
  } catch (error) {
    console.error("Error adding employee:", error.message);
    // Handle duplicate key errors (e.g. email or employeeID conflicts)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Duplicate email or employee ID exists.",
      });
    }
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route   GET /api/employee
 * @desc    Fetch all employees (from the same company as the manager)
 */
router.get("/", verifyUser, async (req, res) => {
  try {
    const employees = await Employee.find({
      companyId: req.user.companyId,
    }).populate("department", "departmentName");

    return res.status(200).json({ success: true, employees });
  } catch (error) {
    console.error("Error fetching employees:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch employees." });
  }
});

/**
 * @route   GET /api/employee/:id
 * @desc    Fetch a single employee by the Employee document's _id
 */
router.get("/:id", verifyUser, async (req, res) => {
  try {
    const employeeId = req.params.id;

    console.log("Received employee ID:", employeeId);
    console.log("User's company ID:", req.user.companyId);
    console.log("User role:", req.user.role);
    console.log("User ID:", req.user._id);

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.error("Invalid employee ID format:", employeeId);
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID format.",
      });
    }

    const query = {
      userId: req.user._id, // Use the userId from the token
      companyId: req.user.companyId,
    };
    console.log("Query parameters:", query);

    const employee = await Employee.findOne(query).populate("department", "departmentName");
    console.log("Query result:", employee);

    if (!employee) {
      console.error("Employee not found or unauthorized:", employeeId);
      return res.status(404).json({
        success: false,
        error: "Employee not found or unauthorized.",
      });
    }

    if (req.user.role === "Employee" && employee.userId.toString() !== req.user._id) {
      console.error("Unauthorized access attempt:", req.user._id);
      return res.status(403).json({
        success: false,
        error: "Unauthorized to view another employee's profile.",
      });
    }

    console.log("Employee found:", employee);
    return res.status(200).json({ success: true, employee });
  } catch (err) {
    console.error("Error fetching employee:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});
/**
 * @route   PUT /api/employee/:id
 * @desc    Update an existing employee (by Employee _id)
 */
router.put("/:id", verifyUser, upload.single("image"), async (req, res) => {
  try {
    // Validate the employee ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID format.",
      });
    }

    // Ensure the employee belongs to the manager's company
    const existingEmployee = await Employee.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
    });
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found or unauthorized.",
      });
    }

    const {
      fullName,
      email,
      employeeID,
      dob,
      gender,
      maritalStatus,
      designation,
      department,
      role, // optional if schema supports role
    } = req.body;

    // Prepare updated data
    const updateData = {
      fullName,
      email,
      employeeID,
      dob: dob ? new Date(dob) : undefined,
      gender,
      maritalStatus,
      designation,
      department,
    };

    // If a new image was uploaded, update the image field
    if (req.file) {
      updateData.image = req.file.filename;
    }

    const updatedEmployee = await Employee.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Employee updated successfully!",
      employee: updatedEmployee,
    });
  } catch (error) {
    console.error("Error updating employee:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error." });
  }
});

/**
 * @route   DELETE /api/employee/:id
 * @desc    Delete an employee (by Employee _id)
 */
router.delete("/:id", verifyUser, async (req, res) => {
  try {
    // Validate the employee ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID format.",
      });
    }

    // Attempt to delete employee from the same company
    const employee = await Employee.findOneAndDelete({
      _id: req.params.id,
      companyId: req.user.companyId,
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found or unauthorized.",
      });
    }

    return res.status(200).json({ success: true, message: "Employee deleted successfully." });
  } catch (error) {
    console.error("Error deleting employee:", error);
    return res.status(500).json({ success: false, error: "Failed to delete employee." });
  }
});

export default router;
