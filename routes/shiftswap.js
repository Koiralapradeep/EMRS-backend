import express from 'express';
import mongoose from 'mongoose';
import { verifyUser } from '../middleware/authMiddleware.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import ShiftSwapRequest from '../models/ShiftSwap.js';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import nodemailer from 'nodemailer';
import dayjs from 'dayjs';

// Verify that ShiftSwapRequest is imported correctly
console.log('ShiftSwapRequest model:', ShiftSwapRequest);

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Function to send shift swap request email
const sendShiftSwapEmail = async (requester, colleague, requesterShift, colleagueShift) => {
  try {
    if (!colleague.email) {
      throw new Error('Colleague email is missing.');
    }

    const requesterShiftDate = new Date(requesterShift.weekStartDate);
    const requesterShiftDay = requesterShift.day.charAt(0).toUpperCase() + requesterShift.day.slice(1);
    const colleagueShiftDate = new Date(colleagueShift.weekStartDate);
    const colleagueShiftDay = colleagueShift.day.charAt(0).toUpperCase() + colleagueShift.day.slice(1);

    const mailOptions = {
      from: process.env.EMAIL_USER || 'letscrackfyp@gmail.com',
      to: colleague.email,
      subject: `Shift Swap Request from ${requester.fullName || requester.name || 'Unknown'}`,
      html: `
        <h2 style="color: #1f2937;">Shift Swap Request</h2>
        <p>Hello ${colleague.fullName || colleague.name || 'Colleague'},</p>
        <p>${requester.fullName || requester.name || 'An employee'} has requested to swap shifts with you:</p>
        <div style="margin: 20px 0; padding: 10px; background-color: #f3f4f6; border-radius: 5px;">
          <p><strong>Your Shift:</strong> ${colleagueShiftDate.toISOString().split('T')[0]} (${colleagueShiftDay}): ${colleagueShift.startTime}–${colleagueShift.endTime}</p>
          <p><strong>Their Shift:</strong> ${requesterShiftDate.toISOString().split('T')[0]} (${requesterShiftDay}): ${requesterShift.startTime}–${requesterShift.endTime}</p>
        </div>
        <p>Please log in to your account to accept or decline this request.</p>
        <p>Best regards,<br>Your Company Team</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Shift swap request email sent to ${colleague.email}`);
  } catch (error) {
    console.error(`Failed to send shift swap email to ${colleague?.email || 'unknown'}:`, error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// Function to send status update email
const sendStatusUpdateEmail = async (recipient, requester, colleagueShift, status) => {
  try {
    if (!recipient.email) {
      throw new Error('Recipient email is missing.');
    }

    const colleagueShiftDate = new Date(colleagueShift.weekStartDate);
    const colleagueShiftDay = colleagueShift.day.charAt(0).toUpperCase() + colleagueShift.day.slice(1);

    const mailOptions = {
      from: process.env.EMAIL_USER || 'letscrackfyp@gmail.com',
      to: recipient.email,
      subject: `Shift Swap Request ${status} by ${requester.fullName || requester.name || 'Unknown'}`,
      html: `
        <h2 style="color: #1f2937;">Shift Swap Request ${status}</h2>
        <p>Hello ${recipient.fullName || recipient.name || 'Employee'},</p>
        <p>Your shift swap request has been ${status.toLowerCase()}:</p>
        <div style="margin: 20px 0; padding: 10px; background-color: #f3f4f6; border-radius: 5px;">
          <p><strong>Shift:</strong> ${colleagueShiftDate.toISOString().split('T')[0]} (${colleagueShiftDay}): ${colleagueShift.startTime}–${colleagueShift.endTime}</p>
        </div>
        <p>Best regards,<br>Your Company Team</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Status update email (${status}) sent to ${recipient.email}`);
  } catch (error) {
    console.error(`Failed to send status update email to ${recipient?.email || 'unknown'}:`, error.message);
    throw new Error(`Failed to send status update email: ${error.message}`);
  }
};

const router = express.Router();

// Log when the router is initialized
console.log('ShiftSwap router initialized');

// Test route to confirm the base path is working
router.get('/test', (req, res) => {
  console.log('GET /api/shift-swap/test called');
  res.status(200).json({ message: 'ShiftSwap test endpoint working' });
});

// GET /api/shift-swap/colleagues/:employeeId
router.get('/colleagues/:employeeId', verifyUser, async (req, res) => {
  console.log('GET /api/shift-swap/colleagues/:employeeId called');
  try {
    const employeeId = req.params.employeeId;
    console.log('Employee ID:', employeeId);

    // Validate employeeId
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId:', employeeId);
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }

    // Fetch the requesting user
    const requestingUser = await User.findById(employeeId).lean();
    if (!requestingUser) {
      console.log('User not found for employeeId:', employeeId);
      return res.status(404).json({ message: 'Employee not found.' });
    }
    console.log('Requesting user:', requestingUser);

    if (!requestingUser.role || requestingUser.role.toLowerCase() !== 'employee') {
      console.log('Unauthorized access for user:', requestingUser);
      return res.status(403).json({ message: 'Unauthorized. Only employees can access this.' });
    }

    // Fetch departmentId from Employee collection
    const employeeDetails = await Employee.findOne({ userId: employeeId }).lean();
    if (!employeeDetails) {
      console.log('Employee details not found for userId:', employeeId);
      return res.status(404).json({ message: 'Employee record not found.' });
    }
    console.log('Employee details:', employeeDetails);

    if (!employeeDetails.department) {
      console.log('Department not found for employee:', employeeDetails);
      return res.status(404).json({ message: 'Employee department not found.' });
    }
    const departmentId = employeeDetails.department.toString();
    console.log('Department ID:', departmentId);

    // Fetch colleagues in the same department
    const colleagues = await Employee.find({
      department: new mongoose.Types.ObjectId(departmentId),
      userId: { $ne: employeeId },
    })
      .populate({
        path: 'userId',
        select: 'name fullName email role',
      })
      .lean();
    console.log('Raw colleagues from database:', colleagues);

    if (!colleagues || colleagues.length === 0) {
      console.log('No colleagues found in department:', departmentId);
      return res.status(200).json([]);
    }

    // Filter colleagues to ensure they are employees and have required fields
    const colleagueList = colleagues
      .filter((emp) => {
        if (!emp.userId) {
          console.log('Skipping colleague without userId:', emp);
          return false;
        }

        console.log('Inspecting colleague userId:', emp.userId);

        if (!emp.userId.role) {
          console.log('Skipping colleague without role:', emp.userId);
          return false;
        }
        const roleLower = emp.userId.role.toLowerCase();
        if (roleLower !== 'employee') {
          console.log(`Skipping colleague with role "${emp.userId.role}" (expected "employee")`, emp.userId);
          return false;
        }

        const displayName = emp.userId.fullName || emp.userId.name;
        if (!displayName) {
          console.log('Colleague missing both fullName and name:', emp.userId);
          return false;
        }

        if (!emp.userId.email) {
          console.log('Colleague missing email:', emp.userId);
          return false;
        }

        return true;
      })
      .map((emp) => ({
        id: emp.userId._id.toString(),
        fullName: emp.userId.fullName || emp.userId.name,
        email: emp.userId.email,
      }));
    console.log('Filtered colleagues:', colleagueList);

    res.status(200).json(colleagueList);
  } catch (error) {
    console.error('Error in /colleagues/:employeeId:', error.stack);
    res.status(500).json({ message: 'Server error while fetching colleagues.', error: error.message });
  }
});

// GET /api/shift-swap/colleague-shifts/:employeeId/:colleagueId
router.get('/colleague-shifts/:employeeId/:colleagueId', verifyUser, async (req, res) => {
  console.log('GET /api/shift-swap/colleague-shifts/:employeeId/:colleagueId called');
  try {
    const employeeId = req.params.employeeId;
    const colleagueId = req.params.colleagueId;
    console.log('Employee ID:', employeeId, 'Colleague ID:', colleagueId);

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId:', employeeId);
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }

    if (!mongoose.Types.ObjectId.isValid(colleagueId)) {
      console.log('Validation failed: Invalid colleagueId:', colleagueId);
      return res.status(400).json({ message: 'Invalid colleagueId.' });
    }

    const requestingUser = await User.findById(employeeId).lean();
    if (!requestingUser) {
      console.log('User not found for employeeId:', employeeId);
      return res.status(404).json({ message: 'Employee not found.' });
    }
    console.log('Requesting user:', requestingUser);

    if (!requestingUser.role || requestingUser.role.toLowerCase() !== 'employee') {
      console.log('Unauthorized access for user:', requestingUser);
      return res.status(403).json({ message: 'Unauthorized. Only employees can access this.' });
    }

    const colleagueUser = await User.findById(colleagueId).lean();
    if (!colleagueUser) {
      console.log('Colleague not found for colleagueId:', colleagueId);
      return res.status(404).json({ message: 'Colleague not found.' });
    }
    console.log('Colleague user:', colleagueUser);

    const employeeDetails = await Employee.findOne({ userId: employeeId }).lean();
    if (!employeeDetails || !employeeDetails.department) {
      console.log('Employee details or department not found for userId:', employeeId);
      return res.status(404).json({ message: 'Employee details or department not found.' });
    }
    const departmentId = employeeDetails.department.toString();
    const companyId = requestingUser.companyId;
    console.log('Company ID:', companyId, 'Department ID:', departmentId);

    const colleagueDetails = await Employee.findOne({ userId: colleagueId }).lean();
    if (!colleagueDetails || !colleagueDetails.department) {
      console.log('Colleague details or department not found for userId:', colleagueId);
      return res.status(404).json({ message: 'Colleague details or department not found.' });
    }
    console.log('Colleague details:', colleagueDetails);

    if (colleagueDetails.department.toString() !== departmentId) {
      console.log('Employees are not in the same department:', {
        employeeDept: departmentId,
        colleagueDept: colleagueDetails.department,
      });
      return res.status(403).json({ message: 'Colleague must be in the same department as you.' });
    }

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      console.log('Missing startDate or endDate:', { startDate, endDate });
      return res.status(400).json({ message: 'startDate and endDate are required.' });
    }

    const startDateObj = new Date(startDate);
    if (isNaN(startDateObj)) {
      console.log('Invalid startDate:', startDate);
      return res.status(400).json({ message: 'Invalid startDate format.' });
    }
    const endDateObj = new Date(endDate);
    if (isNaN(endDateObj)) {
      console.log('Invalid endDate:', endDate);
      return res.status(400).json({ message: 'Invalid endDate format.' });
    }

    console.log('Querying shifts with startDate:', startDateObj, 'endDate:', endDateObj);

    const myShifts = await ShiftSchedule.find({
      employeeId,
      companyId,
      departmentId,
      weekStartDate: startDateObj,
    }).lean();
    console.log('My shifts:', myShifts);

    const colleagueShifts = await ShiftSchedule.find({
      employeeId: colleagueId,
      companyId,
      departmentId,
      weekStartDate: startDateObj,
    })
      .populate({
        path: 'employeeId',
        select: 'name fullName email',
      })
      .lean();
    console.log('Raw colleague shifts:', colleagueShifts);

    if (!colleagueShifts || colleagueShifts.length === 0) {
      console.log('No shifts found for colleague:', colleagueId);
      return res.status(200).json([]);
    }

    const availableShiftsForSwap = colleagueShifts.filter((colleagueShift) => {
      if (!colleagueShift.employeeId) {
        console.log('Skipping colleague shift with missing employeeId:', colleagueShift);
        return false;
      }
      return !myShifts.some(
        (myShift) =>
          myShift.day === colleagueShift.day &&
          myShift.startTime === colleagueShift.startTime &&
          myShift.endTime === colleagueShift.endTime
      );
    });
    console.log('Available shifts for swap:', availableShiftsForSwap);

    const shiftIds = availableShiftsForSwap.map((shift) => shift._id);
    if (shiftIds.length === 0) {
      console.log('No available shifts for swap after filtering.');
      return res.status(200).json([]);
    }

    const existingSwapRequests = await ShiftSwapRequest.find({
      $or: [
        { requesterShiftId: { $in: shiftIds }, employeeId: employeeId, status: 'pending' },
        { colleagueShiftId: { $in: shiftIds }, colleagueId: employeeId, status: 'pending' },
      ],
    }).lean();
    console.log('Existing swap requests:', existingSwapRequests);

    const availableShifts = availableShiftsForSwap.filter(
      (shift) => !existingSwapRequests.some((req) => req.requesterShiftId.toString() === shift._id.toString() || req.colleagueShiftId.toString() === shift._id.toString())
    );
    console.log('Final available shifts:', availableShifts);

    res.status(200).json(availableShifts);
  } catch (error) {
    console.error('Error in /colleague-shifts/:employeeId/:colleagueId:', error.stack);
    res.status(500).json({ message: 'Server error while fetching colleague shifts.', error: error.message });
  }
});

// POST /api/shift-swap/request
router.post('/request', verifyUser, async (req, res) => {
  console.log('POST /api/shift-swap/request called');
  try {
    const { requesterShiftId, colleagueShiftId } = req.body;
    const employeeId = req.user._id;

    console.log('Request body:', req.body);
    console.log('Employee ID (user._id):', employeeId);

    // Validate shift IDs
    if (!requesterShiftId || !mongoose.Types.ObjectId.isValid(requesterShiftId)) {
      console.log('Validation failed: Invalid requesterShiftId:', requesterShiftId);
      return res.status(400).json({ message: 'Invalid requester shift ID.' });
    }

    if (!colleagueShiftId || !mongoose.Types.ObjectId.isValid(colleagueShiftId)) {
      console.log('Validation failed: Invalid colleagueShiftId:', colleagueShiftId);
      return res.status(400).json({ message: 'Invalid colleague shift ID.' });
    }

    // Fetch the requester's shift
    const requesterShift = await ShiftSchedule.findById(requesterShiftId).lean();
    if (!requesterShift) {
      console.log('Requester shift not found:', requesterShiftId);
      return res.status(404).json({ message: 'Requester shift not found.' });
    }
    console.log('Requester shift:', requesterShift);

    // Fetch the colleague's shift
    const colleagueShift = await ShiftSchedule.findById(colleagueShiftId).populate('employeeId', 'fullName name email').lean();
    if (!colleagueShift) {
      console.log('Colleague shift not found:', colleagueShiftId);
      return res.status(404).json({ message: 'Colleague shift not found.' });
    }
    console.log('Colleague shift:', colleagueShift);

    // Ensure the shifts belong to the correct employees
    if (requesterShift.employeeId.toString() !== employeeId.toString()) {
      console.log('Requester shift does not belong to the requesting employee:', { requesterShift, employeeId });
      return res.status(403).json({ message: 'The selected shift does not belong to you.' });
    }

    if (!colleagueShift.employeeId) {
      console.log('Colleague shift has no associated employee:', colleagueShift);
      return res.status(400).json({ message: 'Colleague shift has no associated employee.' });
    }

    if (colleagueShift.employeeId._id.toString() !== colleagueShift.employeeId._id.toString()) {
      console.log('Colleague shift does not belong to the selected colleague:', { colleagueShift });
      return res.status(403).json({ message: 'The selected colleague shift does not belong to the chosen colleague.' });
    }

    // Fetch employee details to get department
    const employeeDetails = await Employee.findOne({ userId: employeeId }).lean();
    if (!employeeDetails || !employeeDetails.department) {
      console.log('Employee details or department not found for userId:', employeeId);
      return res.status(404).json({ message: 'Employee details or department not found.' });
    }
    const departmentId = employeeDetails.department;
    console.log('Employee department ID:', departmentId);

    // Validate department
    if (requesterShift.departmentId.toString() !== departmentId.toString()) {
      console.log('Shift does not belong to the employee\'s department:', { shiftDepartmentId: requesterShift.departmentId, employeeDepartmentId: departmentId });
      return res.status(403).json({ message: 'Shift does not belong to your department.' });
    }

    // Validate that shifts are on the same day
    if (requesterShift.day !== colleagueShift.day) {
      console.log('Shifts are not on the same day:', { requesterShiftDay: requesterShift.day, colleagueShiftDay: colleagueShift.day });
      return res.status(400).json({ message: 'Shifts must be on the same day to swap.' });
    }

    // Validation: Ensure the shift hasn't started and is at least 3 hours in the future
    const now = dayjs();
    const requesterShiftDateTime = dayjs(requesterShift.weekStartDate)
      .add(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(requesterShift.day), 'day')
      .set('hour', parseInt(requesterShift.startTime.split(':')[0]))
      .set('minute', parseInt(requesterShift.startTime.split(':')[1]));
    const colleagueShiftDateTime = dayjs(colleagueShift.weekStartDate)
      .add(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(colleagueShift.day), 'day')
      .set('hour', parseInt(colleagueShift.startTime.split(':')[0]))
      .set('minute', parseInt(colleagueShift.startTime.split(':')[1]));

    console.log('Current time:', now.toISOString());
    console.log('Requester shift start time:', requesterShiftDateTime.toISOString());
    console.log('Colleague shift start time:', colleagueShiftDateTime.toISOString());

    if (now.isAfter(requesterShiftDateTime)) {
      console.log('Validation failed: Requester shift has already started:', { now: now.toISOString(), shiftStart: requesterShiftDateTime.toISOString() });
      return res.status(400).json({ message: 'Cannot swap a shift that has already started.' });
    }

    if (now.isAfter(colleagueShiftDateTime)) {
      console.log('Validation failed: Colleague shift has already started:', { now: now.toISOString(), shiftStart: colleagueShiftDateTime.toISOString() });
      return res.status(400).json({ message: 'Cannot swap a shift that has already started.' });
    }

    const threeHoursBeforeRequesterShift = requesterShiftDateTime.subtract(3, 'hour');
    const threeHoursBeforeColleagueShift = colleagueShiftDateTime.subtract(3, 'hour');

    console.log('Three hours before requester shift:', threeHoursBeforeRequesterShift.toISOString());
    console.log('Three hours before colleague shift:', threeHoursBeforeColleagueShift.toISOString());

    if (now.isAfter(threeHoursBeforeRequesterShift)) {
      console.log('Validation failed: Requester shift swap request must be made at least 3 hours before the shift starts:', {
        now: now.toISOString(),
        threeHoursBefore: threeHoursBeforeRequesterShift.toISOString(),
      });
      return res.status(400).json({ message: 'Shift swap request must be made at least 3 hours before the shift starts.' });
    }

    if (now.isAfter(threeHoursBeforeColleagueShift)) {
      console.log('Validation failed: Colleague shift swap request must be made at least 3 hours before the shift starts:', {
        now: now.toISOString(),
        threeHoursBefore: threeHoursBeforeColleagueShift.toISOString(),
      });
      return res.status(400).json({ message: 'Shift swap request must be made at least 3 hours before the shift starts.' });
    }

    // Check for duplicate pending swap requests for the same shift pair
    const existingDuplicateRequest = await ShiftSwapRequest.findOne({
      requesterShiftId,
      colleagueShiftId,
      status: 'pending',
    });
    if (existingDuplicateRequest) {
      console.log('Duplicate shift swap request found:', existingDuplicateRequest);
      return res.status(400).json({ message: 'A pending swap request for this exact shift pair already exists.' });
    }

    // Check for existing pending swap requests involving either shift
    const existingRequest = await ShiftSwapRequest.findOne({
      $or: [
        { requesterShiftId, employeeId: employeeId, status: 'pending' },
        { colleagueShiftId, colleagueId: colleagueShift.employeeId._id, status: 'pending' },
      ],
    });
    if (existingRequest) {
      console.log('Pending swap request already exists for one of the shifts:', existingRequest);
      return res.status(400).json({ message: 'A pending swap request already exists involving one of these shifts.' });
    }

    // Check for shift conflicts after swapping
    const requesterOtherShifts = await ShiftSchedule.find({
      employeeId: employeeId,
      companyId: requesterShift.companyId,
      weekStartDate: requesterShift.weekStartDate,
      day: colleagueShift.day,
      _id: { $ne: requesterShiftId },
    }).lean();

    const colleagueOtherShifts = await ShiftSchedule.find({
      employeeId: colleagueShift.employeeId._id,
      companyId: colleagueShift.companyId,
      weekStartDate: colleagueShift.weekStartDate,
      day: requesterShift.day,
      _id: { $ne: colleagueShiftId },
    }).lean();

    const colleagueShiftStart = parseInt(colleagueShift.startTime.split(':')[0]) * 60 + parseInt(colleagueShift.startTime.split(':')[1]);
    const colleagueShiftEnd = parseInt(colleagueShift.endTime.split(':')[0]) * 60 + parseInt(colleagueShift.endTime.split(':')[1]);
    const requesterShiftStart = parseInt(requesterShift.startTime.split(':')[0]) * 60 + parseInt(requesterShift.startTime.split(':')[1]);
    const requesterShiftEnd = parseInt(requesterShift.endTime.split(':')[0]) * 60 + parseInt(requesterShift.endTime.split(':')[1]);

    for (const otherShift of requesterOtherShifts) {
      const otherStart = parseInt(otherShift.startTime.split(':')[0]) * 60 + parseInt(otherShift.startTime.split(':')[1]);
      const otherEnd = parseInt(otherShift.endTime.split(':')[0]) * 60 + parseInt(otherShift.endTime.split(':')[1]);
      if (
        (colleagueShiftStart >= otherStart && colleagueShiftStart < otherEnd) ||
        (colleagueShiftEnd > otherStart && colleagueShiftEnd <= otherEnd) ||
        (colleagueShiftStart <= otherStart && colleagueShiftEnd >= otherEnd)
      ) {
        console.log('Shift conflict detected for requester after swapping:', { otherShift, colleagueShift });
        return res.status(400).json({ message: 'The colleague’s shift conflicts with your existing shifts on that day.' });
      }
    }

    for (const otherShift of colleagueOtherShifts) {
      const otherStart = parseInt(otherShift.startTime.split(':')[0]) * 60 + parseInt(otherShift.startTime.split(':')[1]);
      const otherEnd = parseInt(otherShift.endTime.split(':')[0]) * 60 + parseInt(otherShift.endTime.split(':')[1]);
      if (
        (requesterShiftStart >= otherStart && requesterShiftStart < otherEnd) ||
        (requesterShiftEnd > otherStart && requesterShiftEnd <= otherEnd) ||
        (requesterShiftStart <= otherStart && requesterShiftEnd >= otherEnd)
      ) {
        console.log('Shift conflict detected for colleague after swapping:', { otherShift, requesterShift });
        return res.status(400).json({ message: 'Your shift conflicts with the colleague’s existing shifts on that day.' });
      }
    }

    // Create a single swap request
    const swapRequest = new ShiftSwapRequest({
      shiftId: requesterShiftId,
      requesterShiftId,
      colleagueShiftId,
      employeeId: employeeId,
      colleagueId: colleagueShift.employeeId._id,
      companyId: requesterShift.companyId,
      requestedAt: new Date(),
      status: 'pending',
    });

    // Save the swap request
    const savedSwapRequest = await swapRequest.save();
    console.log('Shift swap request saved to database:', savedSwapRequest);

    // Fetch the requester's user details for email
    const requesterUser = await User.findById(employeeId).lean();
    if (!requesterUser) {
      console.log('Requester user not found:', employeeId);
      return res.status(404).json({ message: 'Requester user not found.' });
    }

    // Send email to the colleague
    await sendShiftSwapEmail(requesterUser, colleagueShift.employeeId, requesterShift, colleagueShift);

    console.log('Shift swap request created:', { swapRequestId: savedSwapRequest._id });

    res.status(201).json({
      success: true,
      message: 'Shift swap request created successfully!',
      data: savedSwapRequest,
    });
  } catch (error) {
    console.error('Error in /request:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to create shift swap request.', error: error.message });
  }
});

// POST /api/shift-swap/accept/:requestId
router.post('/accept/:requestId', verifyUser, async (req, res) => {
  console.log('POST /api/shift-swap/accept/:requestId called');
  try {
    const { requestId } = req.params;
    const employeeId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      console.log('Validation failed: Invalid requestId:', requestId);
      return res.status(400).json({ message: 'Invalid requestId.' });
    }

    const swapRequest = await ShiftSwapRequest.findById(requestId);
    if (!swapRequest) {
      console.log('Swap request not found:', requestId);
      return res.status(404).json({ message: 'Swap request not found.' });
    }

    if (swapRequest.status !== 'pending') {
      console.log('Swap request is not pending:', swapRequest.status);
      return res.status(400).json({ message: 'Swap request is not pending.' });
    }

    if (swapRequest.colleagueId.toString() !== employeeId.toString()) {
      console.log('Unauthorized: Employee is not the requested colleague for this swap request:', { employeeId, swapRequest });
      return res.status(403).json({ message: 'Unauthorized: You can only accept swap requests sent to you.' });
    }

    const requesterShift = await ShiftSchedule.findById(swapRequest.requesterShiftId);
    const colleagueShift = await ShiftSchedule.findById(swapRequest.colleagueShiftId);

    if (!requesterShift || !colleagueShift) {
      console.log('One of the shifts not found:', { requesterShift, colleagueShift });
      return res.status(404).json({ message: 'One of the shifts not found.' });
    }

    // Validate shift timing again before accepting
    const now = dayjs();
    const requesterShiftDateTime = dayjs(requesterShift.weekStartDate)
      .add(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(requesterShift.day), 'day')
      .set('hour', parseInt(requesterShift.startTime.split(':')[0]))
      .set('minute', parseInt(requesterShift.startTime.split(':')[1]));
    const colleagueShiftDateTime = dayjs(colleagueShift.weekStartDate)
      .add(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(colleagueShift.day), 'day')
      .set('hour', parseInt(colleagueShift.startTime.split(':')[0]))
      .set('minute', parseInt(colleagueShift.startTime.split(':')[1]));

    if (now.isAfter(requesterShiftDateTime) || now.isAfter(colleagueShiftDateTime)) {
      console.log('Validation failed: One of the shifts has already started:', { now: now.toISOString(), requesterShiftStart: requesterShiftDateTime.toISOString(), colleagueShiftStart: colleagueShiftDateTime.toISOString() });
      return res.status(400).json({ message: 'Cannot accept a swap request for shifts that have already started.' });
    }

    const requesterShiftEmployeeId = requesterShift.employeeId;
    requesterShift.employeeId = colleagueShift.employeeId;
    colleagueShift.employeeId = requesterShiftEmployeeId;

    await requesterShift.save();
    await colleagueShift.save();

    swapRequest.status = 'accepted';
    swapRequest.acceptedBy = employeeId;
    swapRequest.acceptedAt = new Date();
    await swapRequest.save();
    console.log('Shift swap request updated to accepted:', swapRequest);

    // Fetch the requester and colleague for email notification
    const requester = await User.findById(swapRequest.employeeId).lean();
    const colleague = await User.findById(employeeId).lean();
    if (!requester || !colleague) {
      console.log('Requester or colleague not found for notification:', { requester, colleague });
    } else {
      await sendStatusUpdateEmail(requester, colleague, colleagueShift, 'Accepted');
    }

    console.log('Shift swap accepted successfully:', requestId);
    res.status(200).json({ message: 'Shift swap accepted successfully!' });
  } catch (error) {
    console.error('Error in /accept/:requestId:', error.stack);
    res.status(500).json({ message: 'Failed to accept shift swap.', error: error.message });
  }
});

// POST /api/shift-swap/reject/:requestId
router.post('/reject/:requestId', verifyUser, async (req, res) => {
  console.log('POST /api/shift-swap/reject/:requestId called');
  try {
    const { requestId } = req.params;
    const employeeId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      console.log('Validation failed: Invalid requestId:', requestId);
      return res.status(400).json({ message: 'Invalid requestId.' });
    }

    const swapRequest = await ShiftSwapRequest.findById(requestId);
    if (!swapRequest) {
      console.log('Swap request not found:', requestId);
      return res.status(404).json({ message: 'Swap request not found.' });
    }

    if (swapRequest.status !== 'pending') {
      console.log('Swap request is not pending:', swapRequest.status);
      return res.status(400).json({ message: 'Swap request is not pending.' });
    }

    if (swapRequest.colleagueId.toString() !== employeeId.toString()) {
      console.log('Unauthorized: Employee is not the requested colleague for this swap request:', { employeeId, swapRequest });
      return res.status(403).json({ message: 'Unauthorized: You can only reject swap requests sent to you.' });
    }

    const colleagueShift = await ShiftSchedule.findById(swapRequest.colleagueShiftId);

    swapRequest.status = 'rejected';
    swapRequest.rejectedBy = employeeId;
    swapRequest.rejectedAt = new Date();
    await swapRequest.save();
    console.log('Shift swap request updated to rejected:', swapRequest);

    // Fetch the requester and colleague for email notification
    const requester = await User.findById(swapRequest.employeeId).lean();
    const colleague = await User.findById(employeeId).lean();
    if (!requester || !colleague) {
      console.log('Requester or colleague not found for notification:', { requester, colleague });
    } else {
      await sendStatusUpdateEmail(requester, colleague, colleagueShift, 'Rejected');
    }

    console.log('Shift swap rejected successfully:', requestId);
    res.status(200).json({ message: 'Shift swap rejected successfully!' });
  } catch (error) {
    console.error('Error in /reject/:requestId:', error.stack);
    res.status(500).json({ message: 'Failed to reject shift swap.', error: error.message });
  }
});

// POST /api/shift-swap/cancel/:requestId
router.post('/cancel/:requestId', verifyUser, async (req, res) => {
  console.log('POST /api/shift-swap/cancel/:requestId called');
  try {
    const { requestId } = req.params;
    const employeeId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      console.log('Validation failed: Invalid requestId:', requestId);
      return res.status(400).json({ message: 'Invalid requestId.' });
    }

    const swapRequest = await ShiftSwapRequest.findById(requestId);
    if (!swapRequest) {
      console.log('Swap request not found:', requestId);
      return res.status(404).json({ message: 'Swap request not found.' });
    }

    if (swapRequest.status !== 'pending') {
      console.log('Swap request is not pending:', swapRequest.status);
      return res.status(400).json({ message: 'Swap request is not pending.' });
    }

    if (swapRequest.employeeId.toString() !== employeeId.toString()) {
      console.log('Unauthorized: Employee did not create this swap request:', { employeeId, swapRequest });
      return res.status(403).json({ message: 'Unauthorized: You can only cancel your own swap requests.' });
    }

    swapRequest.status = 'cancelled';
    swapRequest.cancelledBy = employeeId;
    swapRequest.cancelledAt = new Date();
    await swapRequest.save();
    console.log('Shift swap request updated to cancelled:', swapRequest);

    console.log('Shift swap cancelled successfully:', requestId);
    res.status(200).json({ message: 'Shift swap cancelled successfully!' });
  } catch (error) {
    console.error('Error in /cancel/:requestId:', error.stack);
    res.status(500).json({ message: 'Failed to cancel shift swap.', error: error.message });
  }
});

// GET /api/shift-swap/requests/:employeeId
router.get('/requests/:employeeId', verifyUser, async (req, res) => {
  console.log('GET /api/shift-swap/requests/:employeeId called');
  try {
    const employeeId = req.params.employeeId;
    console.log('Fetching swap requests for employeeId:', employeeId);

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId:', employeeId);
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }

    if (req.user._id.toString() !== employeeId) {
      console.log('Unauthorized access:', req.user._id, employeeId);
      return res.status(403).json({ message: 'Unauthorized: You can only fetch your own swap requests.' });
    }

    // Fetch swap requests where the user is either the requester (employeeId) or the requested colleague (colleagueId)
    const swapRequests = await ShiftSwapRequest.find({
      $or: [
        { employeeId: employeeId, status: { $in: ['pending', 'accepted', 'rejected', 'cancelled'] } },
        { colleagueId: employeeId, status: { $in: ['pending', 'accepted', 'rejected', 'cancelled'] } },
      ],
    })
      .populate({
        path: 'requesterShiftId',
        populate: {
          path: 'employeeId',
          select: 'name fullName email',
        },
      })
      .populate({
        path: 'colleagueShiftId',
        populate: {
          path: 'employeeId',
          select: 'name fullName email',
        },
      })
      .populate({
        path: 'employeeId',
        select: 'name fullName email',
      })
      .populate({
        path: 'colleagueId',
        select: 'name fullName email',
      })
      .lean();
    console.log('Raw swap requests from database:', swapRequests);

    // Enhanced validation for swap requests
    if (!swapRequests || swapRequests.length === 0) {
      console.log('No swap requests found for employeeId:', employeeId);
      return res.status(200).json([]);
    }

    // Filter out invalid swap requests with detailed logging
    const filteredSwapRequests = swapRequests.filter((request) => {
      if (!request.requesterShiftId) {
        console.log('Skipping swap request with missing requesterShiftId:', request);
        return false;
      }
      if (!request.requesterShiftId.employeeId) {
        console.log('Skipping swap request with missing requesterShiftId.employeeId:', request);
        return false;
      }
      if (!request.colleagueShiftId) {
        console.log('Skipping swap request with missing colleagueShiftId:', request);
        return false;
      }
      if (!request.colleagueShiftId.employeeId) {
        console.log('Skipping swap request with missing colleagueShiftId.employeeId:', request);
        return false;
      }
      if (!request.employeeId) {
        console.log('Skipping swap request with missing employeeId:', request);
        return false;
      }
      const requesterDisplayName = request.employeeId.fullName || request.employeeId.name;
      if (!requesterDisplayName) {
        console.log('Skipping swap request with missing requester name:', request);
        return false;
      }
      if (!request.employeeId.email) {
        console.log('Skipping swap request with missing requester email:', request);
        return false;
      }
      if (!request.colleagueId) {
        console.log('Skipping swap request with missing colleagueId:', request);
        return false;
      }
      const colleagueDisplayName = request.colleagueId.fullName || request.colleagueId.name;
      if (!colleagueDisplayName) {
        console.log('Skipping swap request with missing colleague name:', request);
        return false;
      }
      if (!request.colleagueId.email) {
        console.log('Skipping swap request with missing colleague email:', request);
        return false;
      }
      return true;
    });

    console.log('Fetched and filtered swap requests:', filteredSwapRequests);
    res.status(200).json(filteredSwapRequests);
  } catch (error) {
    console.error('Error in /requests/:employeeId:', {
      message: error.message,
      stack: error.stack,
      employeeId: req.params.employeeId,
    });
    res.status(500).json({ message: 'Failed to fetch shift swap requests.', error: error.message });
  }
});

export default router;