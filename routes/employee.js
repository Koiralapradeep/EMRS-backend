import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import path from "path";
import bcrypt from "bcrypt";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import Department from "../models/Department.js";
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
        error: "All fields are required.",
      });
    }

    // Validate email format
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format.",
      });
    }

    // Validate department ID
    if (!mongoose.Types.ObjectId.isValid(department)) {
      return res.status(400).json({
        success: false,
        error: "Invalid department ID format.",
      });
    }
    const deptExists = await Department.findById(department);
    if (!deptExists) {
      return res.status(400).json({
        success: false,
        error: "Department does not exist.",
      });
    }

    // Validate gender and maritalStatus
    const validGenders = ["Male", "Female", "Other"];
    if (!validGenders.includes(gender)) {
      return res.status(400).json({
        success: false,
        error: "Gender must be Male, Female, or Other.",
      });
    }
    const validMaritalStatuses = ["Single", "Married"];
    if (!validMaritalStatuses.includes(maritalStatus)) {
      return res.status(400).json({
        success: false,
        error: "Marital Status must be Single or Married.",
      });
    }

    // Validate dob format
    const dobDate = new Date(dob);
    if (isNaN(dobDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid Date of Birth format.",
      });
    }

    // Ensure manager has a companyId
    if (!req.user.companyId) {
      return res.status(403).json({
        success: false,
        error: "Access Denied: Manager does not belong to a company.",
      });
    }

    // Check if email already exists in User collection
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User with this email already exists.",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name: fullName,
      email,
      password: hashedPassword,
      role: "Employee",
      companyId: req.user.companyId,
    });
    const savedUser = await newUser.save();

    try {
      // Create new employee
      const newEmployee = new Employee({
        userId: savedUser._id,
        employeeID,
        fullName,
        email,
        dob: dobDate,
        gender,
        maritalStatus,
        designation,
        department,
        companyId: req.user.companyId,
        image: req.file ? req.file.filename : null,
      });
      await newEmployee.save();

      return res.status(201).json({
        success: true,
        message: "Employee added successfully!",
      });
    } catch (error) {
      // Cleanup: Delete the user if employee creation fails
      await User.findByIdAndDelete(savedUser._id);
      throw error;
    }
  } catch (error) {
    console.error("Error adding employee:", error.message);
    if (error.code === 11000) {
      if (error.keyPattern?.employeeID) {
        return res.status(400).json({
          success: false,
          error: "Employee ID already exists in this company.",
        });
      }
      if (error.keyPattern?.email) {
        return res.status(400).json({
          success: false,
          error: "Email already exists.",
        });
      }
    }
    return res.status(500).json({
      success: false,
      error: "Internal Server Error.",
    });
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

    // Validate department IDs for each employee
    for (let employee of employees) {
      if (employee.department && !mongoose.Types.ObjectId.isValid(employee.department)) {
        console.warn(`Invalid department ID for employee ${employee._id}:`, employee.department);
        employee.department = null; // Reset invalid department
      }
    }

    return res.status(200).json({ success: true, employees });
  } catch (error) {
    console.error("Error fetching employees:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch employees.",
    });
  }
});

/**
 * @route   GET /api/employee/:id
 * @desc    Fetch a single employee by the Employee document's _id
 */
router.get("/:id", verifyUser, async (req, res) => {
  try {
    const employeeId = req.params.id;
    console.log("Received ID:", employeeId);
    console.log("User's company ID:", req.user.companyId);
    console.log("User role:", req.user.role);
    console.log("User ID:", req.user._id);

    // Validate token data
    if (!req.user._id) {
      console.error("User ID missing in token:", req.user);
      return res.status(400).json({
        success: false,
        error: "User ID missing in token.",
      });
    }
    if (!req.user.companyId) {
      console.error("Company ID missing in token:", req.user);
      return res.status(400).json({
        success: false,
        error: "Company ID missing in token.",
      });
    }
    if (!req.user.role) {
      console.error("User role missing in token:", req.user);
      return res.status(400).json({
        success: false,
        error: "User role missing in token.",
      });
    }

    let employee;

    if (employeeId) {
      let query = {
        companyId: req.user.companyId,
      };

      if (mongoose.Types.ObjectId.isValid(employeeId)) {
        query._id = employeeId;
        console.log("Querying by employee _id:", employeeId);
        const rawEmployee = await Employee.findOne(query);
        console.log("Raw employee (before population):", rawEmployee);
        if (rawEmployee && rawEmployee.department) {
          const departmentExists = await Department.findById(rawEmployee.department);
          console.log("Department exists in DB:", departmentExists);
          if (!departmentExists) {
            console.warn(`Invalid department ID for employee ${rawEmployee._id}:`, rawEmployee.department);
            rawEmployee.department = null; // Reset invalid department
            await rawEmployee.save();
          }
        }
        employee = await Employee.findOne(query).populate("department", "departmentName");
      }

      if (!employee) {
        query = {
          companyId: req.user.companyId,
          userId: employeeId,
        };
        console.log("Querying by userId:", employeeId);
        const rawEmployee = await Employee.findOne(query);
        console.log("Raw employee (before population):", rawEmployee);
        if (rawEmployee && rawEmployee.department) {
          const departmentExists = await Department.findById(rawEmployee.department);
          console.log("Department exists in DB:", departmentExists);
          if (!departmentExists) {
            console.warn(`Invalid department ID for employee ${rawEmployee._id}:`, rawEmployee.department);
            rawEmployee.department = null;
            await rawEmployee.save();
          }
        }
        employee = await Employee.findOne(query).populate("department", "departmentName");
      }
    } else {
      if (req.user.role === "Employee") {
        const query = {
          companyId: req.user.companyId,
          userId: req.user._id,
        };
        console.log("No ID provided. Querying by logged-in user's ID:", req.user._id);
        const rawEmployee = await Employee.findOne(query);
        console.log("Raw employee (before population):", rawEmployee);
        if (rawEmployee && rawEmployee.department) {
          const departmentExists = await Department.findById(rawEmployee.department);
          console.log("Department exists in DB:", departmentExists);
          if (!departmentExists) {
            console.warn(`Invalid department ID for employee ${rawEmployee._id}:`, rawEmployee.department);
            rawEmployee.department = null;
            await rawEmployee.save();
          }
        }
        employee = await Employee.findOne(query).populate("department", "departmentName");
        console.log("Query result:", employee);
      } else {
        const query = {
          companyId: req.user.companyId,
        };
        console.log("No ID provided. Fetching all employees for Manager:", req.user._id);
        const rawEmployees = await Employee.find(query);
        console.log("Raw employees (before population):", rawEmployees);
        const employees = await Employee.find(query).populate("department", "departmentName");
        console.log("Query result (employees):", employees);

        // Validate department IDs for each employee
        for (let emp of employees) {
          if (emp.department && !mongoose.Types.ObjectId.isValid(emp.department)) {
            console.warn(`Invalid department ID for employee ${emp._id}:`, emp.department);
            emp.department = null;
          }
        }

        return res.status(200).json({ success: true, employees });
      }
    }

    if (!employee) {
      console.error("Employee not found or unauthorized:", employeeId || req.user._id);
      return res.status(404).json({
        success: false,
        error: "Employee not found or unauthorized.",
      });
    }

    if (req.user.role === "Employee") {
      if (!employee.userId) {
        console.error("Employee record missing userId:", employeeId || req.user._id);
        return res.status(500).json({
          success: false,
          error: "Employee record is missing userId.",
        });
      }
      if (employee.userId.toString() !== req.user._id.toString()) {
        console.error("Unauthorized access attempt by employee:", {
          userId: req.user._id,
          employeeUserId: employee.userId.toString(),
        });
        return res.status(403).json({
          success: false,
          error: "Unauthorized to view another employee's profile.",
        });
      }
    }

    console.log("Employee found:", employee);
    console.log("Populated department:", employee.department);
    return res.status(200).json({ success: true, employee });
  } catch (error) {
    console.error("Error fetching employee:", error.message);
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
    // Validate employee ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID format.",
      });
    }

    // Check if employee exists and belongs to the manager's company
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
      role,
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
      !department
    ) {
      return res.status(400).json({
        success: false,
        error: "All fields are required (except role, password, and image).",
      });
    }

    // Validate email format
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format.",
      });
    }

    // Validate department (handle both ID and name)
    let departmentId = department;
    if (!mongoose.Types.ObjectId.isValid(department)) {
      // Assume department is a name, look up the ID
      const dept = await Department.findOne({ departmentName: department, companyId: req.user.companyId });
      if (!dept) {
        return res.status(400).json({
          success: false,
          error: "Department does not exist.",
        });
      }
      departmentId = dept._id;
    }
    const deptExists = await Department.findById(departmentId);
    if (!deptExists) {
      return res.status(400).json({
        success: false,
        error: "Department does not exist.",
      });
    }

    // Validate gender and maritalStatus
    const validGenders = ["Male", "Female", "Other"];
    if (!validGenders.includes(gender)) {
      return res.status(400).json({
        success: false,
        error: "Gender must be Male, Female, or Other.",
      });
    }
    const validMaritalStatuses = ["Single", "Married"];
    if (!validMaritalStatuses.includes(maritalStatus)) {
      return res.status(400).json({
        success: false,
        error: "Marital Status must be Single or Married.",
      });
    }

    // Validate dob format
    const dobDate = new Date(dob);
    if (isNaN(dobDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid Date of Birth format.",
      });
    }

    // Validate role if provided
    const validRoles = ["Employee", "Manager"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Role must be Employee or Manager.",
      });
    }

    // Check for duplicate email in User collection
    const existingUser = await User.findOne({
      email,
      _id: { $ne: existingEmployee.userId },
    });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "Email is already in use by another user.",
      });
    }

    // Debug: Check for existing employees with the same employeeID in the same company
    console.log("Attempting to update employeeID to:", employeeID);
    console.log("Current employeeID:", existingEmployee.employeeID);
    console.log("Company ID:", req.user.companyId);

    const duplicateEmployee = await Employee.findOne({
      employeeID: employeeID,
      companyId: req.user.companyId,
      _id: { $ne: req.params.id }, // Exclude the current employee
    });
    if (duplicateEmployee) {
      console.log("Duplicate employee found before update:", {
        _id: duplicateEmployee._id,
        employeeID: duplicateEmployee.employeeID,
        companyId: duplicateEmployee.companyId,
        fullName: duplicateEmployee.fullName,
        email: duplicateEmployee.email,
      });
      return res.status(400).json({
        success: false,
        error: "Employee ID already exists in this company (manual check).",
      });
    } else {
      console.log("No duplicate employee found before update.");
    }

    // Prepare updated employee data
    const updateEmployeeData = {
      fullName,
      email,
      employeeID,
      dob: dobDate,
      gender,
      maritalStatus,
      designation,
      department: departmentId,
      ...(req.file && { image: req.file.filename }),
    };

    // Update employee
    console.log("Updating employee with data:", updateEmployeeData);
    const updatedEmployee = await Employee.findByIdAndUpdate(
      req.params.id,
      updateEmployeeData,
      {
        new: true,
        runValidators: true,
      }
    );

    // Update user data (name, email, role, and password if provided)
    const updateUserData = {
      name: fullName,
      email,
      ...(role && { role }), // Update role if provided
    };

    if (password) {
      updateUserData.password = await bcrypt.hash(password, 10);
    }

    await User.findByIdAndUpdate(existingEmployee.userId, updateUserData, {
      runValidators: true,
    });

    return res.status(200).json({
      success: true,
      message: "Employee updated successfully!",
      employee: updatedEmployee,
    });
  } catch (error) {
    console.error("Error updating employee:", error.message);
    if (error.code === 11000) {
      console.error("Duplicate key error details:", {
        keyPattern: error.keyPattern,
        keyValue: error.keyValue,
      });
      // Check which index caused the duplicate key error
      if (error.keyPattern?.email) {
        return res.status(400).json({
          success: false,
          error: "Email is already in use by another employee.",
        });
      }
      if (error.keyPattern?.employeeID && error.keyPattern?.companyId) {
        return res.status(400).json({
          success: false,
          error: "Employee ID already exists in this company.",
        });
      }
      if (error.keyPattern?.employeeID) {
        return res.status(400).json({
          success: false,
          error: "Employee ID already exists in the system.",
        });
      }
    }
    return res.status(500).json({
      success: false,
      error: "Internal Server Error.",
    });
  }
});

/**
 * @route   DELETE /api/employee/:id
 * @desc    Delete an employee (by Employee _id)
 */
router.delete("/:id", verifyUser, async (req, res) => {
  try {
    // Validate employee ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID format.",
      });
    }

    // Delete employee
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

    return res.status(200).json({
      success: true,
      message: "Employee deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting employee:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to delete employee.",
    });
  }
});

export default router;