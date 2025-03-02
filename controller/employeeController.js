import Employee from '../models/Employee.js';
import User from '../models/User.js';
import bcrypt from 'bcrypt';
import path from 'path';
import multer from 'multer';

// Setup multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads'); // Ensure 'public/uploads' directory exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Save file with a timestamp
  },
});

const upload = multer({ storage: storage });

//  Add Employee (Ensure companyId is assigned)
const addEmployee = async (req, res) => {
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
      role,
    } = req.body;

    // Validate required fields
    if (!fullName || !email || !employeeID || !dob || !gender || !maritalStatus || !designation || !department || !password || !role) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    // Check for duplicate user
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, error: 'User already registered.' });
    }

    //  Ensure the manager (req.user) has a company assigned
    if (!req.user.companyId) {
      return res.status(403).json({ success: false, error: "Manager does not belong to a company." });
    }

    // Hash the password
    const hashPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name: fullName,
      email,
      password: hashPassword,
      role,
      companyId: req.user.companyId, //  Assign companyId from manager
    });

    const savedUser = await newUser.save();

    // Create new employee
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
      companyId: req.user.companyId, //  Assign companyId from manager
      image: req.file ? req.file.filename : null, // Store image if uploaded
    });

    await newEmployee.save();

    return res.status(201).json({ success: true, message: 'Employee added successfully!' });
  } catch (error) {
    console.error('Error adding employee:', error.message);
    return res.status(500).json({ success: false, error: 'Internal Server Error.' });
  }
};

//  Get Employees (Company-Specific)
const getEmployees = async (req, res) => {
  try {
    const employees = await Employee.find({ companyId: req.user.companyId });
    res.status(200).json({ success: true, employees });
  } catch (error) {
    res.status(500).json({ success: false, error: "Error fetching employees." });
  }
};

export { addEmployee, getEmployees, upload };
