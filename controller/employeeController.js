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

    // Hash the password
    const hashPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      name: fullName,
      email,
      password: hashPassword,
      role,
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
      image: req.file ? req.file.filename : null, // Store image if uploaded
    });

    await newEmployee.save();

    return res.status(201).json({ success: true, message: 'Employee added successfully!' });
  } catch (error) {
    console.error('Error adding employee:', error.message);
    return res.status(500).json({ success: false, error: 'Internal Server Error.' });
  }
};

export { addEmployee, upload };
