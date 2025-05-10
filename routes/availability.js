import express from 'express';
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { verifyUser, authorizeRoles } from '../middleware/authMiddleware.js';
import { Availability, AvailabilityHistory } from '../models/Availability.js';
import ShiftRequirement from '../models/ShiftRequirement.js';
import User from '../models/User.js';
import ShiftSchedule from '../models/ShiftSchedule.js';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import nodemailer from 'nodemailer';

dayjs.extend(utc);

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Function to send schedule email to an employee
const sendScheduleEmail = async (employee, shifts, weekStartDate) => {
  try {
    if (!employee.email) {
      throw new Error('Employee email is missing.');
    }

    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const scheduleDetails = daysOfWeek
      .map((day, index) => {
        const shiftDate = weekStartDate.add(index, 'day').format('YYYY-MM-DD');
        const dayShifts = shifts.filter((shift) => shift.day === day);
        if (dayShifts.length === 0) return null;
        return `<strong>${day.charAt(0).toUpperCase() + day.slice(1)} (${shiftDate}):</strong> ${dayShifts
          .map((shift) => `${shift.startTime}–${shift.endTime}`)
          .join(', ')}`;
      })
      .filter(Boolean)
      .join('<br>');

    const mailOptions = {
      from: process.env.EMAIL_USER || 'letscrackfyp@gmail.com',
      to: employee.email,
      subject: `Your Shift Schedule for the Week of ${weekStartDate.format('YYYY-MM-DD')}`,
      html: `
        <h2 style="color: #1f2937;">Your Shift Schedule</h2>
        <p>Hello ${employee.name},</p>
        <p>Your shift schedule for the week starting <strong>${weekStartDate.format(
          'YYYY-MM-DD'
        )}</strong> has been generated:</p>
        <div style="margin: 20px 0; padding: 10px; background-color: #f3f4f6; border-radius: 5px;">
          ${scheduleDetails || 'No shifts assigned for this week.'}
        </div>
        <p style="margin-top: 20px;">If you have any questions, please contact your manager.</p>
        <p>Best regards,<br>Your Company Team</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Schedule email sent to ${employee.email}`);
  } catch (error) {
    console.error(`Failed to send schedule email to ${employee.email}:`, error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// Helper function to check for overlapping shifts and duplicates
const checkForOverlappingShifts = async (employeeId, weekStartDate, day, startTime, endTime, excludeShiftId = null) => {
  const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
  const endMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);

  const existingShifts = await ShiftSchedule.find({
    employeeId,
    weekStartDate,
    day,
    ...(excludeShiftId && { _id: { $ne: excludeShiftId } }),
  }).lean();

  for (const shift of existingShifts) {
    const shiftStartMinutes = parseInt(shift.startTime.split(':')[0]) * 60 + parseInt(shift.startTime.split(':')[1]);
    const shiftEndMinutes = parseInt(shift.endTime.split(':')[0]) * 60 + parseInt(shift.endTime.split(':')[1]);

    // Check for exact duplicates
    if (shiftStartMinutes === startMinutes && shiftEndMinutes === endMinutes) {
      return true; // Duplicate shift detected
    }

    // Check for overlaps
    if (
      (startMinutes >= shiftStartMinutes && startMinutes < shiftEndMinutes) ||
      (endMinutes > shiftStartMinutes && endMinutes <= shiftEndMinutes) ||
      (startMinutes <= shiftStartMinutes && endMinutes >= shiftEndMinutes)
    ) {
      return true; // Overlap detected
    }
  }
  return false; // No overlap or duplicate
};

const router = express.Router();

router.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    console.error('Database not connected. Current state:', mongoose.connection.readyState);
    return res.status(500).json({ message: 'Database not connected.' });
  }
  next();
});
//add availability
router.post('/', verifyUser, async (req, res) => {
  try {
    const { employeeId, companyId, weekStartDate, weekEndDate, days, note, isRecurring } = req.body;
    console.log('Received POST /api/availability payload:', JSON.stringify(req.body, null, 2));

    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection is not active');
    }

    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId:', employeeId);
      return res.status(400).json({ message: 'Invalid employeeId. Must be a valid ObjectId.' });
    }
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId:', companyId);
      return res.status(400).json({ message: 'Invalid companyId. Must be a valid ObjectId.' });
    }
    if (!weekStartDate || !dayjs.utc(weekStartDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid weekStartDate');
      return res.status(400).json({ message: 'Invalid weekStartDate. Must be in YYYY-MM-DD format.' });
    }
    if (!weekEndDate || !dayjs.utc(weekEndDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid weekEndDate');
      return res.status(400).json({ message: 'Invalid weekEndDate. Must be in YYYY-MM-DD format.' });
    }
    if (!days || typeof days !== 'object') {
      console.log('Validation failed: Invalid days data');
      return res.status(400).json({ message: 'Invalid days data.' });
    }
    if (note && typeof note !== 'string') {
      console.log('Validation failed: Invalid note');
      return res.status(400).json({ message: 'Note must be a string.' });
    }
    if (typeof isRecurring !== 'boolean') {
      console.log('Validation failed: Invalid isRecurring');
      return res.status(400).json({ message: 'isRecurring must be a boolean.' });
    }

    const weekStart = dayjs.utc(weekStartDate, 'YYYY-MM-DD');
    console.log('Parsed weekStartDate (UTC):', weekStart.format('YYYY-MM-DD HH:mm:ss.SSS[Z]'));
    console.log('Day of week (0=Sunday, 6=Saturday):', weekStart.day());
    if (weekStart.day() !== 0) {
      console.log('Validation failed: weekStartDate not a Sunday');
      return res.status(400).json({ message: 'weekStartDate must be a Sunday.' });
    }

    if (req.user._id.toString() !== employeeId && req.user.role !== 'Admin') {
      console.log('Authorization failed:', req.user._id, employeeId);
      return res.status(403).json({ message: 'Unauthorized: You can only submit availability for yourself.' });
    }

    console.log('Fetching employee with ID:', employeeId);
    const employee = await User.findById(employeeId).lean();
    if (!employee) {
      console.log('Validation failed: Employee not found');
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (employee.companyId.toString() !== companyId) {
      console.log('Validation failed: Employee does not belong to the specified company');
      return res.status(400).json({ message: 'Employee does not belong to the specified company.' });
    }

    console.log('Employee details:', {
      employeeId: employee._id.toString(),
      employeeEmail: employee.email,
      employeeCompanyId: employee.companyId.toString(),
    });

    console.log('Validating dates...');
    const weekEnd = dayjs.utc(weekEndDate, 'YYYY-MM-DD');
    console.log('Parsed weekEndDate (UTC):', weekEnd.format('YYYY-MM-DD HH:mm:ss.SSS[Z]'));
    if (weekStart.isBefore(dayjs().utc().startOf('day'))) {
      console.log('Validation failed: weekStartDate not in future');
      return res.status(400).json({ message: 'weekStartDate must be in the future.' });
    }
    const diffDays = weekEnd.diff(weekStart, 'day');
    if (diffDays !== 6) {
      console.log('Validation failed: weekEndDate not 6 days after weekStartDate');
      return res.status(400).json({ message: 'weekEndDate must be exactly 6 days after weekStartDate.' });
    }

    console.log('Validating days structure...');
    const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysOfWeekIndices = validDays.reduce((acc, day, idx) => {
      acc[day] = idx;
      return acc;
    }, {});
    for (const day of validDays) {
      if (!days[day] || typeof days[day] !== 'object') {
        console.log(`Validation failed: Missing or invalid ${day} data`);
        return res.status(400).json({ message: `Invalid data for ${day}.` });
      }
      const { available, slots, note: dayNote } = days[day];
      if (typeof available !== 'boolean') {
        console.log(`Validation failed: Invalid available flag for ${day}`);
        return res.status(400).json({ message: `Invalid available flag for ${day}.` });
      }
      if (!Array.isArray(slots)) {
        console.log(`Validation failed: Slots must be an array for ${day}`);
        return res.status(400).json({ message: `Slots must be an array for ${day}.` });
      }
      if (available && slots.length === 0) {
        console.log(`Validation failed: No slots for available ${day}`);
        return res.status(400).json({ message: `At least one time slot is required for ${day}.` });
      }
      for (const slot of slots) {
        if (!slot.startTime || !slot.endTime || !/^\d{2}:\d{2}$/.test(slot.startTime) || !/^\d{2}:\d{2}$/.test(slot.endTime)) {
          console.log(`Validation failed: Invalid slot format in ${day}`);
          return res.status(400).json({ message: `Invalid time slot format in ${day}.` });
        }
        if (!slot.startDay || !validDays.includes(slot.startDay)) {
          console.log(`Validation failed: Invalid startDay in ${day}`);
          return res.status(400).json({ message: `Invalid startDay in ${day}.` });
        }
        if (!slot.endDay || !validDays.includes(slot.endDay)) {
          console.log(`Validation failed: Invalid endDay in ${day}`);
          return res.status(400).json({ message: `Invalid endDay in ${day}.` });
        }
        if (!slot.shiftType || !['Day', 'Night'].includes(slot.shiftType)) {
          console.log(`Validation failed: Invalid shiftType in ${day}`);
          return res.status(400).json({ message: `Shift type must be "Day" or "Night" in ${day}.` });
        }
        const startDayIdx = daysOfWeekIndices[slot.startDay];
        const endDayIdx = daysOfWeekIndices[slot.endDay];
        const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
        let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
        const adjustedEndMinutes = endDayIdx < startDayIdx || (endDayIdx === startDayIdx && endMinutes <= startMinutes) ? endMinutes + 24 * 60 : endMinutes;
        if (startMinutes === adjustedEndMinutes && slot.startDay === slot.endDay) {
          console.log(`Validation failed: Start time and end time cannot be the same in ${day}`);
          return res.status(400).json({ message: `Start time and end time cannot be the same in ${day} when on the same day.` });
        }
      }
      if (dayNote && typeof dayNote !== 'string') {
        console.log(`Validation failed: Invalid note for ${day}`);
        return res.status(400).json({ message: `Note must be a string for ${day}.` });
      }
    }

    console.log('Calculating total hours...');
    const totalHours = validDays.reduce((sum, day) => {
      if (!days[day].available) return sum;
      console.log(`Calculating hours for ${day}:`, days[day].slots);
      return sum + days[day].slots.reduce((daySum, slot) => {
        const startDayIdx = daysOfWeekIndices[slot.startDay];
        const endDayIdx = daysOfWeekIndices[slot.endDay];
        const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
        let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);

        // Calculate the day difference within the week
        let dayDiff = endDayIdx - startDayIdx;
        if (dayDiff < 0) {
          dayDiff += 7; // Wrap around the week (e.g., Sunday to Monday)
        }

        // Adjust end minutes if end time is earlier than start time on the same day
        let adjustedEndMinutes = endMinutes;
        if (endDayIdx === startDayIdx && endMinutes <= startMinutes) {
          adjustedEndMinutes += 24 * 60;
        }

        // Calculate hours for the time slot on the start day
        let hours = (adjustedEndMinutes - startMinutes) / 60;

        // If the shift spans multiple days, add the additional days' hours
        if (dayDiff > 0) {
          hours += dayDiff * 24;
        }

        console.log(`Slot ${slot.startDay} ${slot.startTime}-${slot.endDay} ${slot.endTime}: ${hours} hours`);
        return daySum + hours;
      }, 0);
    }, 0);
    console.log('Total hours:', totalHours);

    if (totalHours < 10) {
      console.log('Validation failed: Total hours less than 10');
      return res.status(400).json({ message: 'You must provide at least 10 hours of availability.' });
    }

    console.log('Formatting dates for database...');
    const formattedWeekStartDate = new Date(Date.UTC(weekStart.year(), weekStart.month(), weekStart.date()));
    const formattedWeekEndDate = new Date(Date.UTC(weekEnd.year(), weekEnd.month(), weekEnd.date()));
    console.log('Formatted weekStartDate (UTC):', formattedWeekStartDate);
    console.log('Formatted weekEndDate (UTC):', formattedWeekEndDate);

    console.log('Checking for existing availability...');
    const existing = await Availability.findOne({ employeeId, companyId, weekStartDate: formattedWeekStartDate });
    let availability;

    if (existing && dayjs().utc().isBefore(dayjs(existing.weekStartDate).add(6, 'day').endOf('day'))) {
      console.log('Validation failed: Existing record for this week');
      return res.status(400).json({
        message: `Availability already submitted for this week. Wait until ${dayjs(existing.weekStartDate).add(6, 'day').format('MMMM D, YYYY')}.`,
      });
    }

    if (existing) {
      console.log('Updating existing availability:', existing._id);
      existing.days = days;
      existing.note = note || existing.note;
      existing.isRecurring = isRecurring !== undefined ? isRecurring : existing.isRecurring;
      existing.submittedAt = new Date();
      await existing.save();
      availability = existing;
      console.log('Updated availability:', availability._id);
    } else {
      console.log('Creating new availability...');
      availability = new Availability({
        employeeId,
        companyId,
        weekStartDate: formattedWeekStartDate,
        weekEndDate: formattedWeekEndDate,
        days,
        note: note || '',
        isRecurring,
      });
      console.log('Saving new availability:', JSON.stringify(availability, null, 2));
      await availability.save();
      console.log('Created new availability:', availability._id);
    }

    console.log('Logging to AvailabilityHistory...');
    const historyEntry = new AvailabilityHistory({
      availabilityId: availability._id,
      employeeId,
      companyId,
      weekStartDate: formattedWeekStartDate,
      action: existing ? 'updated' : 'created',
      data: availability.toObject(),
      performedBy: req.user._id,
    });
    console.log('Saving history entry:', JSON.stringify(historyEntry, null, 2));
    await historyEntry.save();
    console.log('Logged to AvailabilityHistory:', historyEntry._id);

    if (isRecurring && !existing) {
      console.log('Creating recurring availability for the next 4 weeks');
      for (let i = 1; i <= 4; i++) {
        const nextWeekStart = dayjs(formattedWeekStartDate).add(i * 7, 'day').utc();
        const nextWeekEnd = dayjs(formattedWeekEndDate).add(i * 7, 'day').utc();
        const nextWeekStartDate = new Date(Date.UTC(nextWeekStart.year(), nextWeekStart.month(), nextWeekStart.date()));
        const nextWeekEndDate = new Date(Date.UTC(nextWeekEnd.year(), nextWeekEnd.month(), nextWeekEnd.date()));
        console.log(`Recurring week ${i} - weekStartDate:`, nextWeekStartDate, 'weekEndDate:', nextWeekEndDate);

        const recurringExisting = await Availability.findOne({
          employeeId,
          companyId,
          weekStartDate: nextWeekStartDate,
        });
        if (recurringExisting) {
          console.log(`Skipping recurring week ${i} due to existing availability`);
          continue;
        }

        const nextAvailability = new Availability({
          employeeId,
          companyId,
          weekStartDate: nextWeekStartDate,
          weekEndDate: nextWeekEndDate,
          days,
          note,
          isRecurring: true,
        });
        console.log(`Saving recurring availability for week ${i}:`, JSON.stringify(nextAvailability, null, 2));
        await nextAvailability.save();
        console.log(`Created recurring availability for week ${i}:`, nextAvailability._id);

        const recurringHistoryEntry = new AvailabilityHistory({
          availabilityId: nextAvailability._id,
          employeeId,
          companyId,
          weekStartDate: nextWeekStartDate,
          action: 'created',
          data: nextAvailability.toObject(),
          performedBy: req.user._id,
        });
        console.log(`Saving recurring history entry for week ${i}:`, JSON.stringify(recurringHistoryEntry, null, 2));
        await recurringHistoryEntry.save();
        console.log(`Logged recurring history entry for week ${i}:`, recurringHistoryEntry._id);
      }
    }

    console.log('Availability submission successful:', availability._id);
    return res.status(existing ? 200 : 201).json({
      message: existing ? 'Availability updated successfully.' : 'Availability added successfully!',
      data: availability,
    });
  } catch (error) {
    console.error('Error saving availability:', error.stack);
    if (error.code === 11000) {
      return res.status(400).json({
        message: 'Duplicate availability entry for this employee and week.',
        error: error.message,
      });
    }
    return res.status(500).json({
      message: 'Failed to save availability.',
      error: error.message,
    });
  }
});

router.get('/:employeeId', verifyUser, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { companyId, weekStartDate, availabilityId } = req.query;

    console.log('Fetching availability for employee:', employeeId, 'companyId:', companyId, 'weekStartDate:', weekStartDate, 'availabilityId:', availabilityId);

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId');
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }
    if (req.user._id.toString() !== employeeId && req.user.role !== 'Admin') {
      console.log('Authorization failed:', req.user._id, employeeId);
      return res.status(403).json({ message: 'Unauthorized: You can only fetch your own availability.' });
    }
    if (weekStartDate && !dayjs(weekStartDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid weekStartDate');
      return res.status(400).json({ message: 'Invalid weekStartDate.' });
    }
    if (availabilityId && !mongoose.Types.ObjectId.isValid(availabilityId)) {
      console.log('Validation failed: Invalid availabilityId');
      return res.status(400).json({ message: 'Invalid availabilityId.' });
    }

    const query = { employeeId, companyId };
    if (weekStartDate) {
      const weekStart = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day');
      const formattedWeekStartDate = new Date(Date.UTC(weekStart.year(), weekStart.month(), weekStart.date()));
      query.weekStartDate = formattedWeekStartDate;
      console.log('Querying with weekStartDate (UTC):', formattedWeekStartDate);
    }
    if (availabilityId) {
      query._id = availabilityId;
      console.log('Querying with availabilityId:', availabilityId);
    }

    console.log('Executing query:', query);
    let responseData;
    if (weekStartDate || availabilityId) {
      const availability = await Availability.findOne(query).lean();
      console.log('Found availability for specific week or ID:', availability);
      if (!availability) {
        console.log('No availability found for the specified criteria');
        return res.status(404).json({ message: 'No availability found for the specified week or ID.' });
      }
      responseData = availability;
    } else {
      const availabilities = await Availability.find(query).sort({ weekStartDate: -1 }).lean();
      console.log('Found all availabilities:', availabilities);
      console.log('Total availabilities found:', availabilities.length);
      console.log('Week start dates:', availabilities.map(a => new Date(a.weekStartDate).toISOString()));
      if (!availabilities || availabilities.length === 0) {
        console.log('No availabilities found for the specified criteria');
        return res.status(404).json({ message: 'No availabilities found.' });
      }
      responseData = availabilities;
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching availability:', error);
    return res.status(500).json({ message: 'Failed to fetch availability.', error: error.message });
  }
});

router.get('/company/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { weekStartDate, page = 1, limit = 10, departmentId } = req.query;

    console.log('Fetching availabilities for company:', companyId, 'weekStartDate:', weekStartDate, 'page:', page, 'limit:', limit, 'departmentId:', departmentId);

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (weekStartDate && !dayjs.utc(weekStartDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid weekStartDate');
      return res.status(400).json({ message: 'Invalid weekStartDate.' });
    }
    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (isNaN(pageNum) || pageNum < 1) {
      console.log('Validation failed: Invalid page number');
      return res.status(400).json({ message: 'Page must be a positive integer.' });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      console.log('Validation failed: Invalid limit');
      return res.status(400).json({ message: 'Limit must be a positive integer between 1 and 100.' });
    }

    const query = { companyId };
    if (weekStartDate) {
      const startDate = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day');
      const endDate = startDate.add(6, 'day').endOf('day');
      query.weekStartDate = {
        $gte: startDate.toDate(),
        $lte: endDate.toDate(),
      };
      console.log('Querying with weekStartDate range (UTC):', {
        $gte: startDate.toISOString(),
        $lte: endDate.toISOString(),
      });
    }

    const populateOptions = {
      path: 'employeeId',
      select: 'name email role departmentName',
    };

    console.log('Executing Availability query (without department filter):', JSON.stringify(query, null, 2));
    let availabilities = await Availability.find(query)
      .populate(populateOptions)
      .sort({ weekStartDate: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();
    console.log('Availabilities before department filtering:', JSON.stringify(availabilities, null, 2));

    for (let avail of availabilities) {
      if (!avail.employeeId) {
        console.warn(`Population failed for availability ${avail._id}, fetching employee manually`);
        const employee = await User.findById(avail.employeeId).select('name email role departmentName').lean();
        if (employee) {
          avail.employeeId = employee;
          console.log(`Manually fetched employee for availability ${avail._id}:`, employee);
        } else {
          console.warn(`Employee ${avail.employeeId} not found in users collection`);
          continue;
        }
      }

      // Fetch department from the employees collection and map to departmentId
      if (avail.employeeId && avail.employeeId._id) {
        const employeeDetails = await Employee.findOne({ userId: avail.employeeId._id }).select('department').lean();
        if (employeeDetails && employeeDetails.department) {
          avail.employeeId.departmentId = employeeDetails.department;
        } else {
          console.warn(`No employee details found in employees collection for user ${avail.employeeId._id}`);
          avail.employeeId.departmentId = null;
        }
      } else {
        console.warn(`Skipping department fetch for availability ${avail._id}: employeeId is invalid`);
        avail.employeeId.departmentId = null;
      }

      console.log(`Availability ${avail._id}: employeeId=${JSON.stringify(avail.employeeId)}`);
    }

    const invalidAvailabilities = availabilities.filter((avail) => !avail.employeeId);
    if (invalidAvailabilities.length > 0) {
      console.warn('Availabilities with missing employeeId after manual fetch:', JSON.stringify(invalidAvailabilities, null, 2));
    }
    availabilities = availabilities.filter((avail) => avail.employeeId);

    if (departmentId) {
      availabilities = availabilities.filter((avail) => {
        const matchesDepartment = avail.employeeId.departmentId?.toString() === departmentId;
        console.log(`Availability ${avail._id} for employee ${avail.employeeId.name}: departmentId=${avail.employeeId.departmentId}, matches=${matchesDepartment}`);
        return matchesDepartment;
      });
    }

    console.log('Availabilities after department filtering:', JSON.stringify(availabilities, null, 2));

    let warnings = [];
    if (weekStartDate && availabilities.length > 0) {
      const requestedDate = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day');
      const fetchedDate = dayjs(availabilities[0].weekStartDate).utc().startOf('day');
      if (!requestedDate.isSame(fetchedDate)) {
        warnings.push({
          message: `The requested weekStartDate (${requestedDate.format('YYYY-MM-DD')}) does not match the fetched availability (${fetchedDate.format('YYYY-MM-DD')}). Showing the most recent availability.`,
          requestedDate: requestedDate.toISOString(),
          fetchedDate: fetchedDate.toISOString(),
        });
        console.warn(`Date mismatch: requested ${requestedDate.format('YYYY-MM-DD')}, fetched ${fetchedDate.format('YYYY-MM-DD')}`);
      }
    }

    if (invalidAvailabilities.length > 0) {
      warnings = warnings.concat(
        invalidAvailabilities.map((avail) => ({
          availabilityId: avail._id.toString(),
          employeeId: avail.employeeId?._id?.toString(),
          reason: 'Employee not found in users collection',
        }))
      );
    }

    const total = availabilities.length;
    console.log('Total availabilities after filtering:', total);

    return res.status(200).json({
      data: availabilities,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      warnings: warnings.length > 0 ? {
        message: 'Some availabilities may not match the requested date or were skipped due to missing employee data.',
        details: warnings,
      } : undefined,
    });
  } catch (error) {
    console.error('Error fetching company availabilities:', error.stack);
    return res.status(500).json({
      message: 'Failed to fetch company availabilities.',
      error: error.message,
    });
  }
});

router.put('/:id', verifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, companyId, weekStartDate, weekEndDate, days, note, isRecurring } = req.body;

    console.log('Received PUT /api/availability/:id payload:', JSON.stringify(req.body, null, 2));

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Validation failed: Invalid availability ID');
      return res.status(400).json({ message: 'Invalid availability ID.' });
    }
    if (employeeId && !mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId');
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }
    if (companyId && !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }

    // Authorization check
    if (req.user._id.toString() !== employeeId && req.user.role !== 'Admin') {
      console.log('Authorization failed:', req.user._id, employeeId);
      return res.status(403).json({ message: 'Unauthorized: You can only edit your own availability.' });
    }

    // Find the existing availability
    const availability = await Availability.findById(id);
    if (!availability) {
      console.log('Availability not found:', id);
      return res.status(404).json({ message: 'Availability not found.' });
    }

    // Verify ownership
    if (availability.employeeId.toString() !== employeeId) {
      console.log('Unauthorized: Employee ID mismatch', { availabilityEmployeeId: availability.employeeId, employeeId });
      return res.status(403).json({ message: 'You are not authorized to edit this availability.' });
    }

    const updateFields = {};

    // Update weekStartDate if provided
    if (weekStartDate) {
      // Explicitly parse as UTC and normalize to midnight
      const weekStart = dayjs.utc(weekStartDate).startOf('day');
      console.log('Parsed weekStartDate (UTC):', weekStart.toISOString(), 'Day of week (0=Sunday):', weekStart.day());

      if (!weekStart.isValid()) {
        console.log('Validation failed: Invalid weekStartDate');
        return res.status(400).json({ message: 'Invalid weekStartDate.' });
      }

      // Force adjustment to a Sunday if not already
      if (weekStart.day() !== 0) {
        const daysSinceLastSunday = weekStart.day();
        const adjustedWeekStart = weekStart.subtract(daysSinceLastSunday, 'day');
        console.log('Adjusted weekStartDate to Sunday:', adjustedWeekStart.toISOString(), 'Day of week:', adjustedWeekStart.day());
        return res.status(400).json({ message: `weekStartDate must be a Sunday. Received ${weekStart.format('YYYY-MM-DD')} (day ${weekStart.day()}). Adjusted to ${adjustedWeekStart.format('YYYY-MM-DD')}, please resubmit.` });
      }

      if (weekStart.isBefore(dayjs().utc().startOf('day'))) {
        console.log('Validation failed: weekStartDate not in future');
        return res.status(400).json({ message: 'weekStartDate must be in the future.' });
      }

      updateFields.weekStartDate = new Date(weekStart.toISOString());
      console.log('weekStartDate set for update:', updateFields.weekStartDate);
    }

    // Update weekEndDate if provided
    if (weekEndDate) {
      const weekEnd = dayjs.utc(weekEndDate).startOf('day');
      console.log('Parsed weekEndDate (UTC):', weekEnd.toISOString(), 'Day of week (6=Saturday):', weekEnd.day());

      if (!weekEnd.isValid()) {
        console.log('Validation failed: Invalid weekEndDate');
        return res.status(400).json({ message: 'Invalid weekEndDate.' });
      }

      if (weekEnd.day() !== 6) {
        console.log('Validation failed: weekEndDate not a Saturday');
        return res.status(400).json({ message: 'weekEndDate must be a Saturday.' });
      }

      if (updateFields.weekStartDate) {
        const diffDays = weekEnd.diff(dayjs(updateFields.weekStartDate).utc(), 'day');
        if (diffDays !== 6) {
          console.log('Validation failed: weekEndDate not 6 days after weekStartDate');
          return res.status(400).json({ message: 'weekEndDate must be exactly 6 days after weekStartDate.' });
        }
      }

      updateFields.weekEndDate = new Date(weekEnd.toISOString());
      console.log('weekEndDate set for update:', updateFields.weekEndDate);
    }

    // Update days if provided
    if (days && typeof days === 'object') {
      const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const daysOfWeekIndices = validDays.reduce((acc, day, idx) => {
        acc[day] = idx;
        return acc;
      }, {});

      const mergedDays = validDays.reduce((acc, day) => {
        acc[day] = {
          available: false,
          slots: [],
          note: '',
        };
        return acc;
      }, {});

      for (const day of validDays) {
        if (days[day] && typeof days[day] === 'object') {
          const { available, slots, note: dayNote } = days[day];
          if (typeof available !== 'boolean') {
            console.log(`Validation failed: Invalid available flag for ${day}`);
            return res.status(400).json({ message: `Invalid available flag for ${day}.` });
          }

          if (!available) {
            mergedDays[day] = {
              available: false,
              slots: [],
              note: dayNote && typeof dayNote === 'string' ? dayNote : '',
            };
            continue;
          }

          if (!Array.isArray(slots)) {
            console.log(`Validation failed: Slots must be an array for ${day}`);
            return res.status(400).json({ message: `Slots must be an array for ${day}.` });
          }
          if (available && slots.length === 0) {
            console.log(`Validation failed: No slots for available ${day}`);
            return res.status(400).json({ message: `At least one time slot is required for ${day}.` });
          }
          for (const slot of slots) {
            if (!slot.startTime || !slot.endTime || !/^\d{2}:\d{2}$/.test(slot.startTime) || !/^\d{2}:\d{2}$/.test(slot.endTime)) {
              console.log(`Validation failed: Invalid slot format in ${day}`);
              return res.status(400).json({ message: `Invalid time slot format in ${day}.` });
            }
            if (!slot.startDay || !validDays.includes(slot.startDay)) {
              console.log(`Validation failed: Invalid startDay in ${day}`);
              return res.status(400).json({ message: `Invalid startDay in ${day}.` });
            }
            if (!slot.endDay || !validDays.includes(slot.endDay)) {
              console.log(`Validation failed: Invalid endDay in ${day}`);
              return res.status(400).json({ message: `Invalid endDay in ${day}.` });
            }
            if (!slot.shiftType || !['Day', 'Night'].includes(slot.shiftType)) {
              console.log(`Validation failed: Invalid shiftType in ${day}`);
              return res.status(400).json({ message: `Shift type must be "Day" or "Night" in ${day}.` });
            }
            const startDayIdx = daysOfWeekIndices[slot.startDay];
            const endDayIdx = daysOfWeekIndices[slot.endDay];
            const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
            let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
            const adjustedEndMinutes = endDayIdx < startDayIdx || (endDayIdx === startDayIdx && endMinutes <= startMinutes) ? endMinutes + 24 * 60 : endMinutes;
            if (startMinutes === adjustedEndMinutes && slot.startDay === slot.endDay) {
              console.log(`Validation failed: Start time and end time cannot be the same in ${day}`);
              return res.status(400).json({ message: `Start time and end time cannot be the same in ${day} when on the same day.` });
            }
          }
          if (dayNote && typeof dayNote !== 'string') {
            console.log(`Validation failed: Invalid note for ${day}`);
            return res.status(400).json({ message: `Note must be a string for ${day}.` });
          }
          mergedDays[day] = {
            available,
            slots: available ? slots : [],
            note: dayNote || '',
          };
        }
      }
      console.log('Merged days before update:', JSON.stringify(mergedDays, null, 2));
      updateFields.days = mergedDays;
    }

    if (note && typeof note === 'string') {
      updateFields.note = note;
    }

    if (typeof isRecurring === 'boolean') {
      updateFields.isRecurring = isRecurring;
    }

    console.log('Updating availability with fields:', JSON.stringify(updateFields, null, 2));
    const updatedAvailability = await Availability.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!updatedAvailability) {
      console.log('Availability not found during update:', id);
      return res.status(404).json({ message: 'Availability not found.' });
    }

    await AvailabilityHistory.create({
      availabilityId: updatedAvailability._id,
      employeeId: updatedAvailability.employeeId,
      companyId: updatedAvailability.companyId,
      weekStartDate: updatedAvailability.weekStartDate,
      action: 'updated',
      data: updatedAvailability.toObject(),
      performedBy: req.user._id,
    });

    console.log('Availability update successful:', updatedAvailability._id);
    console.log('Updated availability data:', JSON.stringify(updatedAvailability.toObject(), null, 2));
    return res.status(200).json({
      message: 'Availability updated successfully.',
      data: updatedAvailability,
    });
  } catch (error) {
    console.error('Error updating availability:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Validation error while updating availability.',
        error: error.message,
      });
    }
    return res.status(500).json({
      message: 'Failed to update availability.',
      error: error.message,
    });
  }
});

router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    console.log('Deleting availability:', id, 'for employee:', employeeId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Validation failed: Invalid availability ID');
      return res.status(400).json({ message: 'Invalid availability ID.' });
    }
    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId');
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }

    if (req.user._id.toString() !== employeeId && req.user.role !== 'Admin') {
      console.log('Authorization failed:', req.user._id, employeeId);
      return res.status(403).json({ message: 'Unauthorized.' });
    }

    const availability = await Availability.findById(id);
    if (!availability) {
      console.log('Availability not found:', id);
      return res.status(404).json({ message: 'Availability not found.' });
    }

    if (availability.employeeId.toString() !== employeeId) {
      console.log('Unauthorized: Employee ID mismatch', { availabilityEmployeeId: availability.employeeId, employeeId });
      return res.status(403).json({ message: 'You are not authorized to delete this availability.' });
    }

    const weekEnd = dayjs(availability.weekStartDate).utc().add(6, 'day').endOf('day');
    if (dayjs().utc().isBefore(weekEnd)) {
      console.log('Validation failed: Cannot delete availability until week ends');
      return res.status(400).json({
        message: `Cannot delete availability until the week ends on ${weekEnd.format('MMMM D, YYYY')}.`,
      });
    }

    await AvailabilityHistory.create({
      availabilityId: availability._id,
      employeeId,
      companyId: availability.companyId,
      weekStartDate: availability.weekStartDate,
      action: 'deleted',
      data: availability.toObject(),
      performedBy: req.user._id,
    });

    await availability.deleteOne();
    console.log('Availability deleted successfully:', id);
    return res.status(200).json({ message: 'Availability deleted successfully.' });
  } catch (error) {
    console.error('Error deleting availability:', error);
    return res.status(500).json({ message: 'Failed to delete availability.', error: error.message });
  }
});

router.post('/stop-recurring/:employeeId', verifyUser, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { companyId } = req.body;

    console.log('Stopping recurring availability for employee:', employeeId, 'companyId:', companyId);

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId');
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }

    if (req.user._id.toString() !== employeeId && req.user.role !== 'Admin') {
      console.log('Authorization failed:', req.user._id, employeeId);
      return res.status(403).json({ message: 'Unauthorized.' });
    }

    const futureAvailabilities = await Availability.find({
      employeeId,
      companyId,
      isRecurring: true,
      weekStartDate: { $gt: new Date() },
    });

    for (const avail of futureAvailabilities) {
      await AvailabilityHistory.create({
        availabilityId: avail._id,
        employeeId,
        companyId,
        weekStartDate: avail.weekStartDate,
        action: 'updated',
        data: { ...avail.toObject(), isRecurring: false },
        performedBy: req.user._id,
      });
    }

    await Availability.updateMany(
      { employeeId, companyId, isRecurring: true, weekStartDate: { $gt: new Date() } },
      { isRecurring: false }
    );

    console.log('Recurring availability stopped for future weeks');
    return res.status(200).json({ message: 'Recurring availability stopped for future weeks.' });
  } catch (error) {
    console.error('Error stopping recurring availability:', error);
    return res.status(500).json({ message: 'Failed to stop recurring availability.', error: error.message });
  }
});

router.get('/history/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { employeeId, weekStartDate } = req.query;

    console.log('Fetching history for company:', companyId, 'employeeId:', employeeId, 'weekStartDate:', weekStartDate);

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (employeeId && !mongoose.Types.ObjectId.isValid(employeeId)) {
      console.log('Validation failed: Invalid employeeId');
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }
    if (weekStartDate && !dayjs(weekStartDate).isValid()) {
      console.log('Validation failed: Invalid weekStartDate');
      return res.status(400).json({ message: 'Invalid weekStartDate.' });
    }

    const query = { companyId };
    if (employeeId) query.employeeId = employeeId;
    if (weekStartDate) {
      const date = new Date(weekStartDate);
      date.setHours(0, 0, 0, 0);
      query.weekStartDate = date;
    }

    const history = await AvailabilityHistory.find(query)
      .populate({
        path: 'employeeId performedBy',
        select: 'name email',
        match: { _id: { $exists: true } },
      })
      .sort({ performedAt: -1 })
      .lean();

    const filteredHistory = history.filter((entry) => entry.employeeId && entry.performedBy);
    console.log('Found history entries:', filteredHistory.length);

    return res.status(200).json(filteredHistory);
  } catch (error) {
    console.error('Error fetching availability history:', error);
    return res.status(500).json({ message: 'Failed to fetch availability history.', error: error.message });
  }
});
//fetching analytics
router.get('/analytics/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { weekStartDate, departmentId } = req.query;

    console.log('Fetching analytics for company:', companyId, 'weekStartDate:', weekStartDate, 'departmentId:', departmentId);

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (weekStartDate && !dayjs.utc(weekStartDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid weekStartDate');
      return res.status(400).json({ message: 'Invalid weekStartDate.' });
    }
    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }

    // Add validation for weekStartDate to prevent fetching before the current week
    if (weekStartDate) {
      const today = dayjs().utc();
      const currentWeekStart = today.subtract(today.day(), 'day'); // Sunday of the current week (e.g., May 4)
      const requestedWeekStart = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day');
      if (requestedWeekStart.isBefore(currentWeekStart, 'day')) {
        console.log('Validation failed: Cannot fetch analytics before the current week');
        return res.status(400).json({ message: 'Cannot fetch analytics for weeks before the current week.' });
      }
    }

    const query = { companyId };
    if (weekStartDate) {
      const startDate = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day');
      const endDate = startDate.add(6, 'day').endOf('day');
      query.weekStartDate = {
        $gte: startDate.toDate(),
        $lte: endDate.toDate(),
      };
      console.log('Querying with weekStartDate range (UTC):', {
        $gte: startDate.toISOString(),
        $lte: endDate.toISOString(),
      });
    }

    const populateOptions = {
      path: 'employeeId',
      select: 'name email role departmentName',
    };

    console.log('Executing Availability query for analytics (without department filter):', JSON.stringify(query, null, 2));
    let availabilities = await Availability.find(query)
      .sort({ weekStartDate: -1 })
      .populate(populateOptions)
      .lean();
    console.log('Availabilities before department filtering:', JSON.stringify(availabilities, null, 2));

    for (let avail of availabilities) {
      if (!avail.employeeId) {
        console.warn(`Population failed for availability ${avail._id}, fetching employee manually`);
        const employee = await User.findById(avail.employeeId).select('name email role departmentName').lean();
        if (employee) {
          avail.employeeId = employee;
          console.log(`Manually fetched employee for availability ${avail._id}:`, employee);
        } else {
          console.warn(`Employee ${avail.employeeId} not found in users collection`);
          continue;
        }
      }

      if (avail.employeeId && avail.employeeId._id) {
        const employeeDetails = await Employee.findOne({ userId: avail.employeeId._id }).select('department').lean();
        if (employeeDetails && employeeDetails.department) {
          avail.employeeId.departmentId = employeeDetails.department;
        } else {
          console.warn(`No employee details found in employees collection for user ${avail.employeeId._id}`);
          avail.employeeId.departmentId = null;
        }
      } else {
        console.warn(`Skipping department fetch for availability ${avail._id}: employeeId is invalid`);
        avail.employeeId.departmentId = null;
      }

      console.log(`Availability ${avail._id}: employeeId=${JSON.stringify(avail.employeeId)}`);
    }

    const invalidAvailabilities = availabilities.filter((avail) => !avail.employeeId);
    if (invalidAvailabilities.length > 0) {
      console.warn('Availabilities with invalid employeeId after manual fetch:', JSON.stringify(invalidAvailabilities, null, 2));
    }
    availabilities = availabilities.filter((avail) => avail.employeeId);

    if (departmentId) {
      availabilities = availabilities.filter((avail) => {
        const matchesDepartment = avail.employeeId.departmentId?.toString() === departmentId;
        console.log(`Availability ${avail._id} for employee ${avail.employeeId.name}: departmentId=${avail.employeeId.departmentId}, matches=${matchesDepartment}`);
        return matchesDepartment;
      });
    }

    console.log('Availabilities after department filtering:', JSON.stringify(availabilities, null, 2));

    let warnings = [];
    if (weekStartDate && availabilities.length > 0) {
      const requestedDate = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day');
      const fetchedDate = dayjs(availabilities[0].weekStartDate).utc().startOf('day');
      if (!requestedDate.isSame(fetchedDate)) {
        warnings.push({
          message: `The requested weekStartDate (${requestedDate.format('YYYY-MM-DD')}) does not match the fetched availability (${fetchedDate.format('YYYY-MM-DD')}). Showing the most recent availability.`,
          requestedDate: requestedDate.toISOString(),
          fetchedDate: fetchedDate.toISOString(),
        });
        console.warn(`Date mismatch: requested ${requestedDate.format('YYYY-MM-DD')}, fetched ${fetchedDate.format('YYYY-MM-DD')}`);
      }
    }

    if (invalidAvailabilities.length > 0) {
      warnings = warnings.concat(
        invalidAvailabilities.map((avail) => ({
          availabilityId: avail._id.toString(),
          employeeId: avail.employeeId?._id?.toString(),
          employeeEmail: avail.employeeId?.email,
          reason: 'Employee not found',
        }))
      );
    }

    const days = {
      sunday: { employees: 0, hours: 0 },
      monday: { employees: 0, hours: 0 },
      tuesday: { employees: 0, hours: 0 },
      wednesday: { employees: 0, hours: 0 },
      thursday: { employees: 0, hours: 0 },
      friday: { employees: 0, hours: 0 },
      saturday: { employees: 0, hours: 0 },
    };

    let totalEmployees = new Set();
    let totalHours = 0;
    const daysOfWeekIndices = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    availabilities.forEach((avail) => {
      if (!avail.employeeId) return;

      totalEmployees.add(avail.employeeId._id.toString());

      Object.entries(avail.days).forEach(([day, { available, slots }]) => {
        if (!available) return;

        let dayHours = 0;
        if (slots && slots.length > 0) {
          slots.forEach((slot) => {
            const startDayIdx = daysOfWeekIndices[slot.startDay];
            const endDayIdx = daysOfWeekIndices[slot.endDay];
            const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
            let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);

            let dayDiff = endDayIdx - startDayIdx;
            if (dayDiff < 0) {
              dayDiff += 7;
            }

            let adjustedEndMinutes = endMinutes;
            if (endDayIdx === startDayIdx && endMinutes <= startMinutes) {
              adjustedEndMinutes += 24 * 60;
            }

            let hours = (adjustedEndMinutes - startMinutes) / 60;
            if (dayDiff > 0) {
              hours += dayDiff * 24;
            }

            dayHours += hours;
          });
        } else {
          dayHours = 24;
        }

        days[day].employees += 1;
        days[day].hours += dayHours;
        totalHours += dayHours;
      });
    });

    return res.status(200).json({
      totalEmployees: totalEmployees.size,
      totalHours,
      days,
      warnings: warnings.length > 0 ? {
        message: 'Some availabilities may not match the requested date or were skipped due to missing employee data.',
        details: warnings,
      } : undefined,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error.stack);
    return res.status(500).json({
      message: 'Failed to fetch analytics.',
      error: error.message,
    });
  }
});
//POST /api/availability/shift-requirements
router.post('/shift-requirements', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId, departmentId, sunday, monday, tuesday, wednesday, thursday, friday, saturday } = req.body;
    console.log('Received POST /api/availability/shift-requirements payload:', JSON.stringify(req.body, null, 2));

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }

    const department = await Department.findOne({ _id: departmentId, companyId });
    if (!department) {
      console.log('Validation failed: Department does not belong to the company');
      return res.status(400).json({ message: 'Department does not belong to the company.' });
    }

    const days = { sunday, monday, tuesday, wednesday, thursday, friday, saturday };
    const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysOfWeekIndices = validDays.reduce((acc, day, idx) => {
      acc[day] = idx;
      return acc;
    }, {});

    for (const day of validDays) {
      if (!days[day] || !Array.isArray(days[day])) {
        console.log(`Validation failed: Invalid data for ${day}`);
        return res.status(400).json({ message: `Invalid data for ${day}.` });
      }
      for (const slot of days[day]) {
        if (
          !slot.startTime ||
          !slot.endTime ||
          !/^\d{2}:\d{2}$/.test(slot.startTime) ||
          !/^\d{2}:\d{2}$/.test(slot.endTime)
        ) {
          console.log(`Validation failed: Invalid slot format in ${day}`);
          return res.status(400).json({ message: `Invalid time slot format in ${day}.` });
        }
        if (!slot.startDay || !validDays.includes(slot.startDay)) {
          console.log(`Validation failed: Invalid startDay in ${day}`);
          return res.status(400).json({ message: `Invalid startDay in ${day}.` });
        }
        if (!slot.endDay || !validDays.includes(slot.endDay)) {
          console.log(`Validation failed: Invalid endDay in ${day}`);
          return res.status(400).json({ message: `Invalid endDay in ${day}.` });
        }
        if (!slot.shiftType || !['Day', 'Night'].includes(slot.shiftType)) {
          console.log(`Validation failed: Invalid shiftType in ${day}`);
          return res.status(400).json({ message: `Shift type must be "Day" or "Night" in ${day}.` });
        }
        slot.minEmployees = parseInt(slot.minEmployees);
        if (isNaN(slot.minEmployees) || slot.minEmployees < 1) {
          console.log(`Validation failed: Invalid minEmployees in ${day}`);
          return res.status(400).json({ message: `Minimum employees must be at least 1 in ${day}.` });
        }
      }

      // Check for overlaps within the day's slots
      for (let i = 0; i < days[day].length; i++) {
        const slot = days[day][i];
        const startDayIdx = daysOfWeekIndices[slot.startDay];
        const endDayIdx = daysOfWeekIndices[slot.endDay];
        const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
        let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
        let adjustedEndMinutes = endMinutes;
        let daySpan = 0;

        if (endDayIdx < startDayIdx) {
          daySpan = 7 - startDayIdx + endDayIdx;
        } else if (endDayIdx === startDayIdx && endMinutes <= startMinutes) {
          daySpan = 1;
          adjustedEndMinutes += 24 * 60;
        } else {
          daySpan = endDayIdx - startDayIdx;
          if (endMinutes <= startMinutes) {
            adjustedEndMinutes += 24 * 60;
            daySpan += 1;
          }
        }

        if (startMinutes === adjustedEndMinutes && daySpan === 0) {
          console.log(`Validation failed: Start time and end time cannot be the same in ${day}`);
          return res.status(400).json({ message: `Start time and end time cannot be the same in ${day} when on the same day.` });
        }

        for (let j = 0; j < days[day].length; j++) {
          if (i === j) continue;
          const otherSlot = days[day][j];
          const otherStartDayIdx = daysOfWeekIndices[otherSlot.startDay];
          const otherEndDayIdx = daysOfWeekIndices[otherSlot.endDay];
          const otherStartMinutes = parseInt(otherSlot.startTime.split(':')[0]) * 60 + parseInt(otherSlot.startTime.split(':')[1]);
          let otherEndMinutes = parseInt(otherSlot.endTime.split(':')[0]) * 60 + parseInt(otherSlot.endTime.split(':')[1]);
          let otherAdjustedEndMinutes = otherEndMinutes;
          let otherDaySpan = 0;

          if (otherEndDayIdx < otherStartDayIdx) {
            otherDaySpan = 7 - otherStartDayIdx + otherEndDayIdx;
          } else if (otherEndDayIdx === otherStartDayIdx && otherEndMinutes <= otherStartMinutes) {
            otherDaySpan = 1;
            otherAdjustedEndMinutes += 24 * 60;
          } else {
            otherDaySpan = otherEndDayIdx - otherStartDayIdx;
            if (otherEndMinutes <= otherStartMinutes) {
              otherAdjustedEndMinutes += 24 * 60;
              otherDaySpan += 1;
            }
          }

          const slotStart = startMinutes + startDayIdx * 24 * 60;
          const slotEnd = slotStart + (adjustedEndMinutes - startMinutes) + daySpan * 24 * 60;
          const otherSlotStart = otherStartMinutes + otherStartDayIdx * 24 * 60;
          const otherSlotEnd = otherSlotStart + (otherAdjustedEndMinutes - otherStartMinutes) + otherDaySpan * 24 * 60;

          if (
            (slotStart > otherSlotStart && slotStart < otherSlotEnd) ||
            (slotEnd > otherSlotStart && slotEnd < otherSlotEnd) ||
            (slotStart <= otherSlotStart && slotEnd >= otherSlotEnd)
          ) {
            console.log(`Validation failed: Overlapping slots in ${day}`);
            return res.status(400).json({ message: `Time slots overlap in ${day}.` });
          }
        }
      }
    }

    let shiftRequirement = await ShiftRequirement.findOne({ companyId, departmentId });
    if (shiftRequirement) {
      console.log('Updating existing shift requirements:', shiftRequirement._id);
      shiftRequirement.sunday = sunday;
      shiftRequirement.monday = monday;
      shiftRequirement.tuesday = tuesday;
      shiftRequirement.wednesday = wednesday;
      shiftRequirement.thursday = thursday;
      shiftRequirement.friday = friday;
      shiftRequirement.saturday = saturday;
      await shiftRequirement.save();
    } else {
      console.log('Creating new shift requirements');
      shiftRequirement = new ShiftRequirement({
        companyId,
        departmentId,
        sunday,
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
      });
      await shiftRequirement.save();
    }

    console.log('Shift requirements saved successfully:', shiftRequirement._id);
    return res.status(200).json({ message: 'Shift requirements saved successfully.', data: shiftRequirement });
  } catch (error) {
    console.error('Error saving shift requirements:', error.stack);
    return res.status(500).json({ message: 'Failed to save shift requirements.', error: error.message });
  }
});

// PUT /api/availability/shift-requirements/:companyId/:departmentId/add-slot
router.put('/shift-requirements/:companyId/:departmentId/add-slot', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId, departmentId } = req.params;
    const { day, slot } = req.body;
    console.log('Received PUT /api/availability/shift-requirements/add-slot payload:', JSON.stringify(req.body, null, 2));

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }
    if (!['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(day.toLowerCase())) {
      console.log('Validation failed: Invalid day');
      return res.status(400).json({ message: 'Invalid day.' });
    }
    if (
      !slot ||
      !slot.startTime ||
      !slot.endTime ||
      !/^\d{2}:\d{2}$/.test(slot.startTime) ||
      !/^\d{2}:\d{2}$/.test(slot.endTime)
    ) {
      console.log('Validation failed: Invalid slot format');
      return res.status(400).json({ message: 'Invalid slot format.' });
    }
    if (!slot.startDay || !['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(slot.startDay)) {
      console.log('Validation failed: Invalid startDay');
      return res.status(400).json({ message: 'Invalid startDay.' });
    }
    if (!slot.endDay || !['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(slot.endDay)) {
      console.log('Validation failed: Invalid endDay');
      return res.status(400).json({ message: 'Invalid endDay.' });
    }
    if (!slot.shiftType || !['Day', 'Night'].includes(slot.shiftType)) {
      console.log('Validation failed: Invalid shiftType');
      return res.status(400).json({ message: 'Shift type must be "Day" or "Night".' });
    }

    slot.minEmployees = parseInt(slot.minEmployees);
    if (isNaN(slot.minEmployees) || slot.minEmployees < 1) {
      console.log('Validation failed: Invalid minEmployees');
      return res.status(400).json({ message: 'Minimum employees must be at least 1.' });
    }

    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysOfWeekIndices = daysOfWeek.reduce((acc, d, idx) => {
      acc[d] = idx;
      return acc;
    }, {});
    const startDayIdx = daysOfWeekIndices[slot.startDay];
    const endDayIdx = daysOfWeekIndices[slot.endDay];
    const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
    let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
    let adjustedEndMinutes = endMinutes;
    let daySpan = 0;

    if (endDayIdx < startDayIdx) {
      daySpan = 7 - startDayIdx + endDayIdx;
    } else if (endDayIdx === startDayIdx && endMinutes <= startMinutes) {
      daySpan = 1;
      adjustedEndMinutes += 24 * 60;
    } else {
      daySpan = endDayIdx - startDayIdx;
      if (endMinutes <= startMinutes) {
        adjustedEndMinutes += 24 * 60;
        daySpan += 1;
      }
    }

    if (startMinutes === adjustedEndMinutes && daySpan === 0) {
      console.log('Validation failed: Start time and end time cannot be the same');
      return res.status(400).json({ message: 'Start time and end time cannot be the same when on the same day.' });
    }

    const department = await Department.findOne({ _id: departmentId, companyId });
    if (!department) {
      console.log('Validation failed: Department does not belong to the company');
      return res.status(400).json({ message: 'Department does not belong to the company.' });
    }

    let shiftRequirement = await ShiftRequirement.findOne({ companyId, departmentId });
    if (!shiftRequirement) {
      console.log('Creating new shift requirements');
      shiftRequirement = new ShiftRequirement({
        companyId,
        departmentId,
        sunday: [],
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      });
    }

    const dayLower = day.toLowerCase();
    const existingSlots = shiftRequirement[dayLower];

    for (const otherSlot of existingSlots) {
      const otherStartDayIdx = daysOfWeekIndices[otherSlot.startDay];
      const otherEndDayIdx = daysOfWeekIndices[otherSlot.endDay];
      const otherStartMinutes = parseInt(otherSlot.startTime.split(':')[0]) * 60 + parseInt(otherSlot.startTime.split(':')[1]);
      let otherEndMinutes = parseInt(otherSlot.endTime.split(':')[0]) * 60 + parseInt(otherSlot.endTime.split(':')[1]);
      let otherAdjustedEndMinutes = otherEndMinutes;
      let otherDaySpan = 0;

      if (otherEndDayIdx < otherStartDayIdx) {
        otherDaySpan = 7 - otherStartDayIdx + otherEndDayIdx;
      } else if (otherEndDayIdx === otherStartDayIdx && otherEndMinutes <= otherStartMinutes) {
        otherDaySpan = 1;
        otherAdjustedEndMinutes += 24 * 60;
      } else {
        otherDaySpan = otherEndDayIdx - otherStartDayIdx;
        if (otherEndMinutes <= otherStartMinutes) {
          otherAdjustedEndMinutes += 24 * 60;
          otherDaySpan += 1;
        }
      }

      const slotStart = startMinutes + startDayIdx * 24 * 60;
      const slotEnd = slotStart + (adjustedEndMinutes - startMinutes) + daySpan * 24 * 60;
      const otherSlotStart = otherStartMinutes + otherStartDayIdx * 24 * 60;
      const otherSlotEnd = otherSlotStart + (otherAdjustedEndMinutes - otherStartMinutes) + otherDaySpan * 24 * 60;

      if (
        (slotStart > otherSlotStart && slotStart < otherSlotEnd) ||
        (slotEnd > otherSlotStart && slotEnd < otherSlotEnd) ||
        (slotStart <= otherSlotStart && slotEnd >= otherSlotEnd)
      ) {
        console.log(`Validation failed: Overlapping slots in ${day}`);
        return res.status(400).json({ message: `Time slot overlaps with an existing slot on ${day}.` });
      }
    }

    shiftRequirement[dayLower].push(slot);
    await shiftRequirement.save();

    console.log('Slot added successfully:', shiftRequirement._id);
    return res.status(200).json({ message: 'Slot added successfully.', data: shiftRequirement });
  } catch (error) {
    console.error('Error adding slot:', error.stack);
    return res.status(500).json({ message: 'Failed to add slot.', error: error.message });
  }
});

// PUT /api/availability/shift-requirements/:companyId/:departmentId/edit-slot
router.put('/shift-requirements/:companyId/:departmentId/edit-slot', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId, departmentId } = req.params;
    const { day, slotIndex, slot } = req.body;
    console.log('Received PUT /api/availability/shift-requirements/edit-slot payload:', JSON.stringify(req.body, null, 2));

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }
    if (!['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(day.toLowerCase())) {
      console.log('Validation failed: Invalid day');
      return res.status(400).json({ message: 'Invalid day.' });
    }
    if (
      !slot ||
      !slot.startTime ||
      !slot.endTime ||
      !/^\d{2}:\d{2}$/.test(slot.startTime) ||
      !/^\d{2}:\d{2}$/.test(slot.endTime)
    ) {
      console.log('Validation failed: Invalid slot format');
      return res.status(400).json({ message: 'Invalid slot format.' });
    }
    if (typeof slotIndex !== 'number' || slotIndex < 0) {
      console.log('Validation failed: Invalid slot index');
      return res.status(400).json({ message: 'Invalid slot index.' });
    }
    if (!slot.startDay || !['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(slot.startDay)) {
      console.log('Validation failed: Invalid startDay');
      return res.status(400).json({ message: 'Invalid startDay.' });
    }
    if (!slot.endDay || !['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(slot.endDay)) {
      console.log('Validation failed: Invalid endDay');
      return res.status(400).json({ message: 'Invalid endDay.' });
    }
    if (!slot.shiftType || !['Day', 'Night'].includes(slot.shiftType)) {
      console.log('Validation failed: Invalid shiftType');
      return res.status(400).json({ message: 'Shift type must be "Day" or "Night".' });
    }

    slot.minEmployees = parseInt(slot.minEmployees);
    if (isNaN(slot.minEmployees) || slot.minEmployees < 1) {
      console.log('Validation failed: Invalid minEmployees');
      return res.status(400).json({ message: 'Minimum employees must be at least 1.' });
    }

    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysOfWeekIndices = daysOfWeek.reduce((acc, d, idx) => {
      acc[d] = idx;
      return acc;
    }, {});
    const startDayIdx = daysOfWeekIndices[slot.startDay];
    const endDayIdx = daysOfWeekIndices[slot.endDay];
    const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
    let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
    let adjustedEndMinutes = endMinutes;
    let daySpan = 0;

    if (endDayIdx < startDayIdx) {
      daySpan = 7 - startDayIdx + endDayIdx;
    } else if (endDayIdx === startDayIdx && endMinutes <= startMinutes) {
      daySpan = 1;
      adjustedEndMinutes += 24 * 60;
    } else {
      daySpan = endDayIdx - startDayIdx;
      if (endMinutes <= startMinutes) {
        adjustedEndMinutes += 24 * 60;
        daySpan += 1;
      }
    }

    if (startMinutes === adjustedEndMinutes && daySpan === 0) {
      console.log('Validation failed: Start time and end time cannot be the same');
      return res.status(400).json({ message: 'Start time and end time cannot be the same when on the same day.' });
    }

    const department = await Department.findOne({ _id: departmentId, companyId });
    if (!department) {
      console.log('Validation failed: Department does not belong to the company');
      return res.status(400).json({ message: 'Department does not belong to the company.' });
    }

    const shiftRequirement = await ShiftRequirement.findOne({ companyId, departmentId });
    if (!shiftRequirement) {
      console.log('Shift requirements not found');
      return res.status(404).json({ message: 'Shift requirements not found.' });
    }

    const dayLower = day.toLowerCase();
    const slots = shiftRequirement[dayLower];
    if (slotIndex >= slots.length) {
      console.log('Validation failed: Slot index out of bounds');
      return res.status(400).json({ message: 'Slot index out of bounds.' });
    }

    for (let i = 0; i < slots.length; i++) {
      if (i === slotIndex) continue;
      const otherSlot = slots[i];
      const otherStartDayIdx = daysOfWeekIndices[otherSlot.startDay];
      const otherEndDayIdx = daysOfWeekIndices[otherSlot.endDay];
      const otherStartMinutes = parseInt(otherSlot.startTime.split(':')[0]) * 60 + parseInt(otherSlot.startTime.split(':')[1]);
      let otherEndMinutes = parseInt(otherSlot.endTime.split(':')[0]) * 60 + parseInt(otherSlot.endTime.split(':')[1]);
      let otherAdjustedEndMinutes = otherEndMinutes;
      let otherDaySpan = 0;

      if (otherEndDayIdx < otherStartDayIdx) {
        otherDaySpan = 7 - otherStartDayIdx + otherEndDayIdx;
      } else if (otherEndDayIdx === otherStartDayIdx && otherEndMinutes <= otherStartMinutes) {
        otherDaySpan = 1;
        otherAdjustedEndMinutes += 24 * 60;
      } else {
        otherDaySpan = otherEndDayIdx - otherStartDayIdx;
        if (otherEndMinutes <= otherStartMinutes) {
          otherAdjustedEndMinutes += 24 * 60;
          otherDaySpan += 1;
        }
      }

      const slotStart = startMinutes + startDayIdx * 24 * 60;
      const slotEnd = slotStart + (adjustedEndMinutes - startMinutes) + daySpan * 24 * 60;
      const otherSlotStart = otherStartMinutes + otherStartDayIdx * 24 * 60;
      const otherSlotEnd = otherSlotStart + (otherAdjustedEndMinutes - otherStartMinutes) + otherDaySpan * 24 * 60;

      if (
        (slotStart > otherSlotStart && slotStart < otherSlotEnd) ||
        (slotEnd > otherSlotStart && slotEnd < otherSlotEnd) ||
        (slotStart <= otherSlotStart && slotEnd >= otherSlotEnd)
      ) {
        console.log(`Validation failed: Overlapping slots in ${day}`);
        return res.status(400).json({ message: `Time slot overlaps with another slot on ${day}.` });
      }
    }

    slots[slotIndex] = slot;
    shiftRequirement[dayLower] = slots;
    await shiftRequirement.save();

    console.log('Slot updated successfully:', shiftRequirement._id);
    return res.status(200).json({ message: 'Slot updated successfully.', data: shiftRequirement });
  } catch (error) {
    console.error('Error updating slot:', error.stack);
    return res.status(500).json({ message: 'Failed to update slot.', error: error.message });
  }
});

// PUT /api/availability/shift-requirements/:companyId/:departmentId/delete-slot
router.put('/shift-requirements/:companyId/:departmentId/edit-slot', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId, departmentId } = req.params;
    const { day, slotIndex, slot } = req.body;
    console.log('Received PUT /api/availability/shift-requirements/edit-slot payload:', JSON.stringify(req.body, null, 2));

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }
    if (!['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(day.toLowerCase())) {
      console.log('Validation failed: Invalid day');
      return res.status(400).json({ message: 'Invalid day.' });
    }
    if (
      !slot ||
      !slot.startTime ||
      !slot.endTime ||
      !/^\d{2}:\d{2}$/.test(slot.startTime) ||
      !/^\d{2}:\d{2}$/.test(slot.endTime)
    ) {
      console.log('Validation failed: Invalid slot format');
      return res.status(400).json({ message: 'Invalid slot format.' });
    }
    if (typeof slotIndex !== 'number' || slotIndex < 0) {
      console.log('Validation failed: Invalid slot index');
      return res.status(400).json({ message: 'Invalid slot index.' });
    }
    if (!slot.startDay || !['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(slot.startDay)) {
      console.log('Validation failed: Invalid startDay');
      return res.status(400).json({ message: 'Invalid startDay.' });
    }
    if (!slot.endDay || !['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(slot.endDay)) {
      console.log('Validation failed: Invalid endDay');
      return res.status(400).json({ message: 'Invalid endDay.' });
    }
    if (!slot.shiftType || !['Day', 'Night'].includes(slot.shiftType)) {
      console.log('Validation failed: Invalid shiftType');
      return res.status(400).json({ message: 'Shift type must be "Day" or "Night".' });
    }

    slot.minEmployees = parseInt(slot.minEmployees);
    if (isNaN(slot.minEmployees) || slot.minEmployees < 1) {
      console.log('Validation failed: Invalid minEmployees');
      return res.status(400).json({ message: 'Minimum employees must be at least 1.' });
    }

    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const daysOfWeekIndices = daysOfWeek.reduce((acc, d, idx) => {
      acc[d] = idx;
      return acc;
    }, {});
    const startDayIdx = daysOfWeekIndices[slot.startDay];
    const endDayIdx = daysOfWeekIndices[slot.endDay];
    const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
    let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
    let adjustedEndMinutes = endMinutes;
    let daySpan = 0;

    if (endDayIdx < startDayIdx) {
      daySpan = 7 - startDayIdx + endDayIdx;
    } else if (endDayIdx === startDayIdx && endMinutes <= startMinutes) {
      daySpan = 1;
      adjustedEndMinutes += 24 * 60;
    } else {
      daySpan = endDayIdx - startDayIdx;
      if (endMinutes <= startMinutes) {
        adjustedEndMinutes += 24 * 60;
        daySpan += 1;
      }
    }

    if (startMinutes === adjustedEndMinutes && daySpan === 0) {
      console.log('Validation failed: Start time and end time cannot be the same');
      return res.status(400).json({ message: 'Start time and end time cannot be the same when on the same day.' });
    }

    const department = await Department.findOne({ _id: departmentId, companyId });
    if (!department) {
      console.log('Validation failed: Department does not belong to the company');
      return res.status(400).json({ message: 'Department does not belong to the company.' });
    }

    const shiftRequirement = await ShiftRequirement.findOne({ companyId, departmentId });
    if (!shiftRequirement) {
      console.log('Shift requirements not found');
      return res.status(404).json({ message: 'Shift requirements not found.' });
    }

    const dayLower = day.toLowerCase();
    const slots = shiftRequirement[dayLower];
    if (slotIndex >= slots.length) {
      console.log('Validation failed: Slot index out of bounds');
      return res.status(400).json({ message: 'Slot index out of bounds.' });
    }

    for (let i = 0; i < slots.length; i++) {
      if (i === slotIndex) continue;
      const otherSlot = slots[i];
      const otherStartDayIdx = daysOfWeekIndices[otherSlot.startDay];
      const otherEndDayIdx = daysOfWeekIndices[otherSlot.endDay];
      const otherStartMinutes = parseInt(otherSlot.startTime.split(':')[0]) * 60 + parseInt(otherSlot.startTime.split(':')[1]);
      let otherEndMinutes = parseInt(otherSlot.endTime.split(':')[0]) * 60 + parseInt(otherSlot.endTime.split(':')[1]);
      let otherAdjustedEndMinutes = otherEndMinutes;
      let otherDaySpan = 0;

      if (otherEndDayIdx < otherStartDayIdx) {
        otherDaySpan = 7 - otherStartDayIdx + otherEndDayIdx;
      } else if (otherEndDayIdx === otherStartDayIdx && otherEndMinutes <= otherStartMinutes) {
        otherDaySpan = 1;
        otherAdjustedEndMinutes += 24 * 60;
      } else {
        otherDaySpan = otherEndDayIdx - otherStartDayIdx;
        if (otherEndMinutes <= otherStartMinutes) {
          otherAdjustedEndMinutes += 24 * 60;
          otherDaySpan += 1;
        }
      }

      const slotStart = startMinutes + startDayIdx * 24 * 60;
      const slotEnd = slotStart + (adjustedEndMinutes - startMinutes) + daySpan * 24 * 60;
      const otherSlotStart = otherStartMinutes + otherStartDayIdx * 24 * 60;
      const otherSlotEnd = otherSlotStart + (otherAdjustedEndMinutes - otherStartMinutes) + otherDaySpan * 24 * 60;

      if (
        (slotStart > otherSlotStart && slotStart < otherSlotEnd) ||
        (slotEnd > otherSlotStart && slotEnd < otherSlotEnd) ||
        (slotStart <= otherSlotStart && slotEnd >= otherSlotEnd)
      ) {
        console.log(`Validation failed: Overlapping slots in ${day}`);
        return res.status(400).json({ message: `Time slot overlaps with another slot on ${day}.` });
      }
    }

    slots[slotIndex] = slot;
    shiftRequirement[dayLower] = slots;
    await shiftRequirement.save();

    console.log('Slot updated successfully:', shiftRequirement._id);
    return res.status(200).json({ message: 'Slot updated successfully.', data: shiftRequirement });
  } catch (error) {
    console.error('Error updating slot:', error.stack);
    return res.status(500).json({ message: 'Failed to update slot.', error: error.message });
  }
});
//GET /api/availability/shift-requirements/:companyId
router.get('/shift-requirements/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { departmentId } = req.query;
    console.log(`Received GET /api/availability/shift-requirements/${companyId} with query:`, req.query);

    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }

    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }

    const department = await Department.findOne({ _id: departmentId, companyId });
    if (departmentId && !department) {
      console.log('Validation failed: Department does not belong to the company');
      return res.status(400).json({ message: 'Department does not belong to the company.' });
    }

    const query = { companyId };
    if (departmentId) {
      query.departmentId = departmentId;
    }

    const shiftRequirements = await ShiftRequirement.find(query);
    console.log('Fetched shift requirements:', shiftRequirements);

    return res.status(200).json(shiftRequirements);
  } catch (error) {
    console.error('Error fetching shift requirements:', error.stack);
    return res.status(500).json({ message: 'Failed to fetch shift requirements.', error: error.message });
  }
});

//auto-schedule:
router.post('/auto-schedule/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { startDate, endDate, departmentId } = req.body;
    console.log('Auto-schedule request received:', { companyId, startDate, endDate, departmentId });

    // Validate inputs
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId. Must be a valid ObjectId.' });
    }

    if (!startDate || !dayjs.utc(startDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid startDate');
      return res.status(400).json({ message: 'Invalid startDate. Must be in YYYY-MM-DD format.' });
    }

    if (!endDate || !dayjs.utc(endDate, 'YYYY-MM-DD').isValid()) {
      console.log('Validation failed: Invalid endDate');
      return res.status(400).json({ message: 'Invalid endDate. Must be in YYYY-MM-DD format.' });
    }

    const start = dayjs.utc(startDate).startOf('day');
    const end = dayjs.utc(endDate).startOf('day');
    if (start.isAfter(end)) {
      console.log('Validation failed: Invalid date range');
      return res.status(400).json({ message: 'startDate must be before or equal to endDate.' });
    }

    if (start.day() !== 0) {
      console.log('Validation failed: startDate must be a Sunday');
      return res.status(400).json({ message: 'startDate must be a Sunday.' });
    }

    if (end.day() !== 6) {
      console.log('Validation failed: endDate must be a Saturday');
      return res.status(400).json({ message: 'endDate must be a Saturday.' });
    }

    const diffDays = end.diff(start, 'day');
    if (diffDays !== 6) {
      console.log('Validation failed: Date range must be exactly one week');
      return res.status(400).json({ message: 'Date range must be exactly one week (from Sunday to Saturday).' });
    }

    // Add validation for startDate to prevent scheduling before the current week
    const today = dayjs().utc();
    const currentWeekStart = today.subtract(today.day(), 'day'); // Sunday of the current week (e.g., May 4)
    if (start.isBefore(currentWeekStart, 'day')) {
      console.log('Validation failed: Cannot schedule before the current week');
      return res.status(400).json({ message: 'Cannot generate a schedule for weeks before the current week.' });
    }

    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      console.log('Validation failed: Invalid departmentId');
      return res.status(400).json({ message: 'Invalid departmentId. Must be a valid ObjectId.' });
    }

    // Verify department belongs to the company
    console.log('Fetching department with query:', { _id: departmentId, companyId });
    const department = await Department.findOne({ _id: departmentId, companyId }).lean();
    if (!department) {
      console.log('Validation failed: Department does not belong to the company');
      return res.status(400).json({ message: 'Department does not belong to the company.' });
    }
    console.log('Department found:', department);

    // Fetch existing shifts to prevent overlaps and duplicates
    const existingShiftsQuery = {
      companyId,
      weekStartDate: start.toDate(),
      departmentId,
    };
    console.log('Fetching existing shifts with query:', existingShiftsQuery);
    const existingShifts = await ShiftSchedule.find(existingShiftsQuery).lean();
    console.log('Existing shifts for the week:', JSON.stringify(existingShifts, null, 2));

    // Fetch availabilities with retry mechanism
    const availabilityQuery = {
      companyId,
      weekStartDate: start.toDate(),
    };
    console.log('Fetching availabilities with query:', availabilityQuery);

    let allAvailabilities;
    let retries = 5;
    while (retries > 0) {
      allAvailabilities = await Availability.find(availabilityQuery)
        .populate({
          path: 'employeeId',
          select: 'name email role',
        })
        .lean();
      if (allAvailabilities.length > 0) break;
      console.log('No availabilities found, retrying...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      retries--;
    }

    if (!allAvailabilities || allAvailabilities.length === 0) {
      console.log('No availabilities found after retries');
      return res.status(400).json({ message: 'No availabilities found for the specified week.' });
    }
    console.log('All availabilities for company and week:', JSON.stringify(allAvailabilities, null, 2));

    // Manually fetch department information for each availability
    for (let avail of allAvailabilities) {
      if (!avail.employeeId) {
        console.warn(`Population failed for availability ${avail._id}, fetching employee manually`);
        const employee = await User.findById(avail.employeeId).select('name email role').lean();
        if (employee) {
          avail.employeeId = employee;
        } else {
          console.warn(`Employee ${avail.employeeId} not found in users collection`);
          continue;
        }
      }

      if (avail.employeeId && avail.employeeId._id) {
        console.log(`Fetching employee details for user ${avail.employeeId._id}`);
        const employeeDetails = await Employee.findOne({ userId: avail.employeeId._id }).select('department').lean();
        if (employeeDetails && employeeDetails.department) {
          avail.employeeId.departmentId = employeeDetails.department;
        } else {
          console.warn(`No employee details found in employees collection for user ${avail.employeeId._id}. Attempting to fetch from User collection.`);
          const user = await User.findById(avail.employeeId._id).select('departmentId').lean();
          avail.employeeId.departmentId = user?.departmentId || null;
        }
      } else {
        console.warn(`Skipping department fetch for availability ${avail._id}: employeeId is invalid`);
        avail.employeeId.departmentId = null;
      }
      console.log(`Availability ${avail._id} for employee ${avail.employeeId?.email}:`, {
        employeeId: avail.employeeId?._id?.toString(),
        departmentId: avail.employeeId?.departmentId?.toString(),
        days: avail.days,
      });
    }

    // Filter out invalid availabilities
    allAvailabilities = allAvailabilities.filter((avail) => {
      const isValid = avail.employeeId && avail.employeeId._id;
      console.log(`Filtering availability ${avail._id}: Is valid? ${isValid}`);
      return isValid;
    });
    console.log('Availabilities after filtering invalid entries:', JSON.stringify(allAvailabilities, null, 2));

    let availabilities = allAvailabilities.filter((avail) => {
      if (!avail.employeeId.departmentId) {
        console.warn(`Employee ${avail.employeeId?.email} has no departmentId. Excluding from scheduling.`);
        return false;
      }
      const matches = avail.employeeId.departmentId.toString() === departmentId.toString();
      console.log('Filtering availability by department for employee:', {
        employeeEmail: avail.employeeId?.email,
        employeeDepartmentId: avail.employeeId?.departmentId?.toString(),
        requestedDepartmentId: departmentId.toString(),
        matches,
      });
      return matches;
    });

    if (!availabilities || availabilities.length === 0) {
      console.log('No availabilities found after department filtering');
      return res.status(400).json({ message: 'No availabilities found for the specified department. Ensure employees are assigned to the correct department.' });
    }

    // Fetch shift requirements
    const shiftRequirementsQuery = { companyId, departmentId };
    console.log('Fetching shift requirements with query:', shiftRequirementsQuery);
    const shiftRequirements = await ShiftRequirement.find(shiftRequirementsQuery).lean();
    console.log('Fetched shift requirements:', JSON.stringify(shiftRequirements, null, 2));
    if (!shiftRequirements || shiftRequirements.length === 0) {
      console.log('No shift requirements found');
      return res.status(400).json({ message: 'No shift requirements defined for the department.' });
    }

    // Fetch department for naming in conflicts
    const departmentName = department.departmentName || 'Unknown';
    console.log('Department name for conflicts:', departmentName);

    // Scheduling logic with improved overlap handling
    const shifts = [];
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const fairnessMetricsByDept = {};
    const employeeShifts = {};
    const employeeAssignments = {};
    const employeeHours = {};

    const daysOfWeekIndices = daysOfWeek.reduce((acc, d, idx) => {
      acc[d] = idx;
      return acc;
    }, {});
    console.log('Days of week indices:', daysOfWeekIndices);

    // Track employees assigned per day to prevent multiple shifts on the same day
    const employeesAssignedPerDay = {};

    for (const requirement of shiftRequirements) {
      const deptId = requirement.departmentId.toString();
      fairnessMetricsByDept[deptId] = { totalHours: 0, shiftsAssigned: 0, employeesAssigned: new Set() };

      for (let i = 0; i < daysOfWeek.length; i++) {
        const day = daysOfWeek[i];
        let slots = requirement[day];
        if (!slots || slots.length === 0) {
          console.log(`No slots defined for ${day}`);
          continue;
        }

        // Initialize tracking for this day
        if (!employeesAssignedPerDay[day]) {
          employeesAssignedPerDay[day] = new Set();
        }

        // Preprocess shift requirement slots
        slots = slots.map(slot => {
          const slotStartDayIdx = daysOfWeekIndices[slot.startDay.toLowerCase()];
          const slotEndDayIdx = daysOfWeekIndices[slot.endDay.toLowerCase()];
          const slotStartMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
          let slotEndMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
          let adjustedSlotEndMinutes = slotEndMinutes;
          let daySpan = 0;

          if (slotEndDayIdx < slotStartDayIdx) {
            daySpan = 7 - slotStartDayIdx + slotEndDayIdx;
            adjustedSlotEndMinutes += daySpan * 24 * 60;
          } else if (slotEndDayIdx === slotStartDayIdx && slotEndMinutes <= slotStartMinutes) {
            daySpan = 1;
            adjustedSlotEndMinutes += 24 * 60;
          } else {
            daySpan = slotEndDayIdx - slotStartDayIdx;
            if (slotEndMinutes <= slotStartMinutes) {
              adjustedSlotEndMinutes += 24 * 60;
              daySpan += 1;
            }
          }

          const durationMinutes = adjustedSlotEndMinutes - slotStartMinutes;
          const duration = durationMinutes / 60;

          // Normalize shiftType based on time range
          let normalizedShiftType = slot.shiftType ? slot.shiftType.toLowerCase() : null;
          const startHour = parseInt(slot.startTime.split(':')[0]);
          const inferredShiftType = startHour >= 18 || startHour < 6 ? 'night' : 'day';
          if (!normalizedShiftType) {
            normalizedShiftType = inferredShiftType;
            console.log(`Inferred shiftType for slot ${slot.startTime}-${slot.endTime} on ${day}: ${normalizedShiftType}`);
          } else if (normalizedShiftType !== inferredShiftType) {
            console.warn(`Shift type mismatch with time range for slot ${slot.startTime}-${slot.endTime} on ${day}:`, {
              databaseShiftType: slot.shiftType,
              inferredShiftType,
            });
            normalizedShiftType = inferredShiftType; // Prioritize inferred shift type based on time
          }

          return {
            ...slot,
            shiftType: normalizedShiftType,
            slotStartDayIdx,
            slotEndDayIdx,
            slotStartMinutes,
            adjustedSlotEndMinutes,
            duration,
            daySpan
          };
        }).sort((a, b) => a.slotStartMinutes - b.slotStartMinutes);

        const currentDate = start.add(i, 'day').toDate();
        const assignedTimeSlots = new Map();

        for (const slot of slots) {
          console.log(`Processing slot for ${day}:`, slot);

          const slotStartMinutes = slot.slotStartMinutes;
          const adjustedSlotEndMinutes = slot.adjustedSlotEndMinutes;
          const slotStartDayIdx = slot.slotStartDayIdx;
          const slotEndDayIdx = slot.slotEndDayIdx;
          const slotDuration = slot.duration;

          // Check if this slot is fully covered by existing assignments
          let remainingMinEmployees = slot.minEmployees;
          const coveringAssignments = [];
          for (const [employeeId, timeSlots] of assignedTimeSlots) {
            for (const assigned of timeSlots) {
              if (
                slotStartMinutes >= assigned.startMinutes &&
                adjustedSlotEndMinutes <= assigned.adjustedEndMinutes &&
                assigned.slotStartDayIdx === slotStartDayIdx &&
                assigned.slotEndDayIdx === slotEndDayIdx
              ) {
                coveringAssignments.push({ employeeId, assigned });
                remainingMinEmployees--;
                if (remainingMinEmployees <= 0) break;
              }
            }
            if (remainingMinEmployees <= 0) break;
          }

          if (remainingMinEmployees <= 0) {
            console.log(`Slot ${slot.startTime}-${slot.endTime} on ${day} is already fully covered by existing assignments`);
            continue;
          }

          const availableEmployees = [];
          for (const avail of availabilities) {
            const employeeIdStr = avail.employeeId?._id?.toString();
            if (!employeeIdStr) {
              console.log(`Skipping availability ${avail._id}: No employeeId`);
              continue;
            }

            // Check if the employee has already been assigned a shift on this day
            if (employeesAssignedPerDay[day].has(employeeIdStr)) {
              console.log(`Employee ${avail.employeeId.email} already assigned a shift on ${day}. Skipping for this slot.`);
              continue;
            }

            const dayAvailability = avail.days[day];
            if (!dayAvailability || !dayAvailability.available) {
              console.log(`Employee ${avail.employeeId.email} is not available on ${day}. Raw days data:`, JSON.stringify(avail.days, null, 2));
              continue;
            }

            const matchingSlot = dayAvailability.slots.find((s) => {
              if (!s.startTime || !s.endTime || !/^\d{2}:\d{2}$/.test(s.startTime) || !/^\d{2}:\d{2}$/.test(s.endTime)) {
                console.log(`Invalid slot format for employee ${avail.employeeId.email} on ${day}:`, s);
                return false;
              }

              // Normalize shiftType for availability
              let normalizedAvailableShiftType = s.shiftType ? s.shiftType.toLowerCase() : null;
              const startHour = parseInt(s.startTime.split(':')[0]);
              const inferredShiftType = startHour >= 18 || startHour < 6 ? 'night' : 'day';
              if (!normalizedAvailableShiftType) {
                normalizedAvailableShiftType = inferredShiftType;
                console.log(`Inferred shiftType for availability slot ${s.startTime}-${s.endTime} on ${day} for employee ${avail.employeeId.email}: ${normalizedAvailableShiftType}`);
              } else if (normalizedAvailableShiftType !== inferredShiftType) {
                console.warn(`Shift type mismatch with time range for availability slot ${s.startTime}-${s.endTime} on ${day} for employee ${avail.employeeId.email}:`, {
                  databaseShiftType: s.shiftType,
                  inferredShiftType,
                });
                normalizedAvailableShiftType = inferredShiftType; // Prioritize inferred shift type based on time
              }

              // Match shiftType
              if (normalizedAvailableShiftType !== slot.shiftType) {
                console.log(`Shift type mismatch for ${avail.employeeId.email} on ${day}:`, {
                  requiredShiftType: slot.shiftType,
                  availableShiftType: normalizedAvailableShiftType,
                });
                return false;
              }

              const sStartDayIdx = daysOfWeekIndices[s.startDay.toLowerCase()];
              const sEndDayIdx = daysOfWeekIndices[s.endDay.toLowerCase()];
              const sStartMinutes = parseInt(s.startTime.split(':')[0]) * 60 + parseInt(s.startTime.split(':')[1]);
              let sEndMinutes = parseInt(s.endTime.split(':')[0]) * 60 + parseInt(s.endTime.split(':')[1]);
              let adjustedSEndMinutes = sEndMinutes;
              let sDaySpan = 0;

              if (sEndDayIdx < sStartDayIdx) {
                sDaySpan = 7 - sStartDayIdx + sEndDayIdx;
                adjustedSEndMinutes += sDaySpan * 24 * 60;
              } else if (sEndDayIdx === sStartDayIdx && sEndMinutes <= sStartMinutes) {
                sDaySpan = 1;
                adjustedSEndMinutes += 24 * 60;
              } else {
                sDaySpan = sEndDayIdx - sStartDayIdx;
                if (sEndMinutes <= sStartMinutes) {
                  adjustedSEndMinutes += 24 * 60;
                  sDaySpan += 1;
                }
              }

              // Check if the availability slot covers the required slot
              const slotMatchesStartDay = sStartDayIdx === slotStartDayIdx;
              if (!slotMatchesStartDay) {
                console.log(`Start day mismatch for ${avail.employeeId.email} on ${day}:`, {
                  requiredStartDay: slot.startDay,
                  availableStartDay: s.startDay,
                });
                return false;
              }

              // Simplified overlap check: ensure the availability covers the required slot
              const coversStart = sStartMinutes <= slotStartMinutes;
              let coversEnd = false;
              if (sEndDayIdx > sStartDayIdx || (sEndDayIdx === sStartDayIdx && adjustedSEndMinutes >= adjustedSlotEndMinutes)) {
                // Availability either spans days or ends late enough on the same day
                coversEnd = true;
              }

              const overlaps = coversStart && coversEnd;

              console.log(`Checking overlap for ${avail.employeeId.email} on ${day}:`, {
                required: `${slot.startTime}-${slot.endTime} (Day ${slotStartDayIdx} to ${slotEndDayIdx}, Type: ${slot.shiftType})`,
                available: `${s.startTime}-${s.endTime} (Day ${sStartDayIdx} to ${sEndDayIdx}, Type: ${normalizedAvailableShiftType})`,
                slotStartMinutes,
                adjustedSlotEndMinutes,
                sStartMinutes,
                adjustedSEndMinutes,
                slotMatchesStartDay,
                coversStart,
                coversEnd,
                overlaps,
                rawSlot: s,
              });
              return overlaps;
            });

            if (!matchingSlot) {
              console.log(`No matching slot found for employee ${avail.employeeId.email} on ${day}. Available slots:`, JSON.stringify(dayAvailability.slots, null, 2));
              continue;
            }

            const sStartMinutes = parseInt(matchingSlot.startTime.split(':')[0]) * 60 + parseInt(matchingSlot.startTime.split(':')[1]);
            let sEndMinutes = parseInt(matchingSlot.endTime.split(':')[0]) * 60 + parseInt(matchingSlot.endTime.split(':')[1]);
            let adjustedSEndMinutes = sEndMinutes;
            let sStartDayIdx = daysOfWeekIndices[matchingSlot.startDay.toLowerCase()];
            let sEndDayIdx = daysOfWeekIndices[matchingSlot.endDay.toLowerCase()];
            let sDaySpan = 0;

            if (sEndDayIdx < sStartDayIdx) {
              sDaySpan = 7 - sStartDayIdx + sEndDayIdx;
              adjustedSEndMinutes += sDaySpan * 24 * 60;
            } else if (sEndDayIdx === sStartDayIdx && sEndMinutes <= sStartMinutes) {
              sDaySpan = 1;
              adjustedSEndMinutes += 24 * 60;
            } else {
              sDaySpan = sEndDayIdx - sStartDayIdx;
              if (sEndMinutes <= sStartMinutes) {
                adjustedSEndMinutes += 24 * 60;
                sDaySpan += 1;
              }
            }

            // Calculate the actual overlapping time for the shift
            const actualStartMinutes = Math.max(sStartMinutes, slotStartMinutes);
            const actualEndMinutes = adjustedSlotEndMinutes; // Since the overlap check passed, use the required slot's end time

            if (actualEndMinutes <= actualStartMinutes) {
              actualEndMinutes += 24 * 60;
            }

            const actualDurationMinutes = actualEndMinutes - actualStartMinutes;
            const actualDurationHours = actualDurationMinutes / 60;

            const requiredDurationMinutes = adjustedSlotEndMinutes - slotStartMinutes;
            const requiredDurationHours = requiredDurationMinutes / 60;
            const coveragePercentage = (actualDurationHours / requiredDurationHours) * 100;

            console.log(`Coverage calculation for ${avail.employeeId.email} on ${day}:`, {
              actualStartMinutes,
              actualEndMinutes,
              actualDurationHours,
              requiredDurationHours,
              coveragePercentage,
            });

            if (coveragePercentage < 100) {
              console.log(`Employee ${avail.employeeId.email} does not fully cover the shift (Coverage: ${coveragePercentage.toFixed(2)}%)`);
              continue;
            }

            const actualStart = `${Math.floor(actualStartMinutes / 60).toString().padStart(2, '0')}:${(actualStartMinutes % 60).toString().padStart(2, '0')}`;
            const actualEnd = `${Math.floor((actualEndMinutes % (24 * 60)) / 60).toString().padStart(2, '0')}:${(actualEndMinutes % 60).toString().padStart(2, '0')}`;

            const currentHours = employeeHours[employeeIdStr] || 0;
            const shiftHours = actualDurationHours;
            console.log(`Employee ${avail.employeeId.email} current hours: ${currentHours}, adding shift of ${shiftHours} hours on ${day}`);

            availableEmployees.push({
              ...avail,
              actualStart,
              actualEnd,
              preference: matchingSlot.preference || 0,
              currentHours,
              coveragePercentage,
              shiftHours,
              slotStartDayIdx: sStartDayIdx,
              slotEndDayIdx: sEndDayIdx,
              adjustedSEndMinutes
            });
          }

          availableEmployees.sort((a, b) => {
            const coverageDiff = b.coveragePercentage - a.coveragePercentage;
            if (coverageDiff !== 0) return coverageDiff;
            const hoursDiff = a.currentHours - b.currentHours;
            if (hoursDiff !== 0) return hoursDiff;
            return b.preference - a.preference;
          });

          console.log(`Available employees for ${day} slot ${slot.startTime}-${slot.endTime}:`, JSON.stringify(availableEmployees.map((emp) => ({
            email: emp.employeeId?.email,
            actualStart: emp.actualStart,
            actualEnd: emp.actualEnd,
            preference: emp.preference,
            currentHours: emp.currentHours,
            coveragePercentage: emp.coveragePercentage,
            shiftHours: emp.shiftHours,
            slotStartDayIdx: emp.slotStartDayIdx,
            slotEndDayIdx: emp.slotEndDayIdx,
          }), null, 2)));

          if (availableEmployees.length < remainingMinEmployees) {
            return res.status(400).json({
              message: 'Not enough employees available to fulfill shift requirements. Please ensure employees have submitted their availability or adjust the shift requirements.',
              conflicts: [{
                departmentName,
                day,
                startTime: slot.startTime,
                endTime: slot.endTime,
                required: slot.minEmployees,
                assigned: slot.minEmployees - remainingMinEmployees,
                availableEmployees: availableEmployees.map((emp) => ({
                  name: emp.employeeId ? emp.employeeId.name : 'Unknown',
                  preference: emp.preference,
                  currentHours: emp.currentHours,
                  availableTime: `${emp.actualStart}-${emp.actualEnd}`,
                })),
              }],
            });
          }

          for (let j = 0; j < remainingMinEmployees; j++) {
            const employee = availableEmployees[j];
            if (!employee || !employee.employeeId || !employee.employeeId._id) {
              console.log('Invalid employee data at index', j, ':', employee);
              throw new Error('Invalid employee data: employeeId is missing or invalid.');
            }

            const employeeIdStr = employee.employeeId._id.toString();
            const shift = new ShiftSchedule({
              companyId,
              departmentId: requirement.departmentId,
              employeeId: employee.employeeId._id,
              weekStartDate: start.toDate(),
              day,
              startTime: employee.actualStart,
              endTime: employee.actualEnd,
              durationHours: employee.shiftHours,
            });

            console.log('Saving shift for employee:', employee.employeeId?.email, shift);
            await shift.save();
            shifts.push(shift);

            // Mark the employee as assigned for this day
            employeesAssignedPerDay[day].add(employeeIdStr);

            if (!assignedTimeSlots.has(employeeIdStr)) {
              assignedTimeSlots.set(employeeIdStr, []);
            }
            assignedTimeSlots.get(employeeIdStr).push({
              startMinutes: parseInt(employee.actualStart.split(':')[0]) * 60 + parseInt(employee.actualStart.split(':')[1]),
              adjustedEndMinutes: employee.adjustedSEndMinutes,
              slotStartDayIdx: employee.slotStartDayIdx,
              slotEndDayIdx: employee.slotEndDayIdx,
            });

            employeeHours[employeeIdStr] = (employeeHours[employeeIdStr] || 0) + employee.shiftHours;

            if (!employeeShifts[employeeIdStr]) {
              employeeShifts[employeeIdStr] = {
                employee: employee.employeeId,
                shifts: [],
              };
            }
            employeeShifts[employeeIdStr].shifts.push(shift);

            if (!employeeAssignments[employeeIdStr]) {
              employeeAssignments[employeeIdStr] = [];
            }
            employeeAssignments[employeeIdStr].push({ day, shift });

            fairnessMetricsByDept[deptId].totalHours += employee.shiftHours;
            fairnessMetricsByDept[deptId].shiftsAssigned += 1;
            fairnessMetricsByDept[deptId].employeesAssigned.add(employeeIdStr);
          }
        }
      }
    }

    for (const deptId in fairnessMetricsByDept) {
      fairnessMetricsByDept[deptId].employeesAssigned = fairnessMetricsByDept[deptId].employeesAssigned.size;
    }

    if (Object.keys(employeeShifts).length > 0) {
      console.log('Sending email notifications to employees:', Object.keys(employeeShifts));
      for (const employeeId in employeeShifts) {
        const { employee, shifts } = employeeShifts[employeeId];
        try {
          await sendScheduleEmail(employee, shifts, start);
          console.log(`Successfully sent schedule email to ${employee.email}`);
        } catch (emailError) {
          console.error(`Failed to send schedule email to ${employee.email}:`, emailError.message);
        }
      }
    } else {
      console.log('No shifts assigned, skipping email notifications');
    }

    console.log('Schedule generated successfully:', { shifts, fairnessMetricsByDept });
    return res.status(200).json({ shifts, fairnessMetricsByDept });
  } catch (error) {
    console.error('Error generating schedule:', error.stack);
    return res.status(500).json({ message: 'Failed to generate schedule.', error: error.message, stack: error.stack });
  }
});

// POST /shift-schedule: Add a new shift with overlap validation
router.post('/shift-schedule/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { employeeId, companyId, weekStartDate, day, startTime, endTime } = req.body;
    console.log('Received POST /api/availability/shift-schedule payload:', JSON.stringify(req.body, null, 2));

    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: 'Invalid employeeId.' });
    }
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!weekStartDate || !dayjs.utc(weekStartDate, 'YYYY-MM-DD').isValid()) {
      return res.status(400).json({ message: 'Invalid weekStartDate.' });
    }
    if (!['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(day)) {
      return res.status(400).json({ message: 'Invalid day.' });
    }
    if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return res.status(400).json({ message: 'Invalid time format.' });
    }

    const start = dayjs(`2025-01-01 ${startTime}`, 'YYYY-MM-DD HH:mm').utc();
    const end = dayjs(`2025-01-01 ${endTime}`, 'YYYY-MM-DD HH:mm').utc();
    if (start.isSame(end) || start.isAfter(end)) {
      return res.status(400).json({ message: 'Start time must be before end time.' });
    }

    // Check for overlapping shifts
    const weekStart = dayjs.utc(weekStartDate, 'YYYY-MM-DD').startOf('day').toDate();
    const hasOverlap = await checkForOverlappingShifts(employeeId, weekStart, day, startTime, endTime);
    if (hasOverlap) {
      return res.status(400).json({ message: `Employee already has a shift on ${day} that overlaps with ${startTime}-${endTime}.` });
    }

    const shift = new ShiftSchedule({
      employeeId,
      companyId,
      weekStartDate: weekStart,
      day,
      startTime,
      endTime,
    });

    await shift.save();
    console.log('Shift created successfully:', shift._id);
    return res.status(201).json({ message: 'Shift created successfully.', data: shift });
  } catch (error) {
    console.error('Error creating shift:', error.stack);
    return res.status(500).json({ message: 'Failed to create shift.', error: error.message });
  }
});

// GET /schedule/:companyId: Allow employees to fetch their own shifts
router.get('/schedule/:companyId', verifyUser, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { startDate, endDate, departmentId } = req.query;

    // Validate inputs
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      console.log('Validation failed: Invalid companyId');
      return res.status(400).json({ message: 'Invalid companyId.' });
    }

    if (!startDate || !endDate) {
      console.log('Validation failed: Start date and end date are required');
      return res.status(400).json({ message: 'Start date and end date are required.' });
    }

    const start = dayjs.utc(startDate).startOf('day');
    const end = dayjs.utc(endDate).startOf('day');
    if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
      console.log('Validation failed: Invalid date range');
      return res.status(400).json({ message: 'Invalid date range.' });
    }

    // Add validation for startDate to prevent fetching before the current week
    const today = dayjs().utc();
    const currentWeekStart = today.subtract(today.day(), 'day'); // Sunday of the current week (e.g., May 4)
    if (start.isBefore(currentWeekStart, 'day')) {
      console.log('Validation failed: Cannot fetch shifts before the current week');
      return res.status(400).json({ message: 'Cannot fetch shifts for weeks before the current week.' });
    }

    // Build query
    const query = {
      companyId,
      weekStartDate: start.toDate(),
    };

    if (departmentId) {
      if (!mongoose.Types.ObjectId.isValid(departmentId)) {
        console.log('Validation failed: Invalid departmentId');
        return res.status(400).json({ message: 'Invalid departmentId.' });
      }
      query.departmentId = departmentId;
    }

    // If the user is an employee, restrict to their own shifts
    if (req.user.role.toLowerCase() === 'employee') {
      query.employeeId = req.user._id;
      // Ensure the employee belongs to the specified department (if provided)
      if (departmentId) {
        const employee = await Employee.findOne({ userId: req.user._id }).lean();
        if (!employee || !employee.department || employee.department.toString() !== departmentId) {
          console.log('Validation failed: Employee does not belong to the specified department');
          return res.status(403).json({ message: 'You do not belong to the specified department.' });
        }
      }
    } else if (req.user.role.toLowerCase() !== 'manager') {
      console.log('Authorization failed: User is neither an employee nor a manager');
      return res.status(403).json({ message: 'Unauthorized: You must be an employee or manager to fetch shifts.' });
    }

    console.log('Fetching shifts with query:', query);

    // Fetch shifts and populate employeeId without nested departmentId
    const shifts = await ShiftSchedule.find(query)
      .populate({
        path: 'employeeId',
        select: "name email role",
      })
      .lean();

    // Manually fetch department information for each shift
    for (let shift of shifts) {
      if (shift.employeeId && shift.employeeId._id) {
        const employeeDetails = await Employee.findOne({ userId: shift.employeeId._id }).select('department').lean();
        if (employeeDetails && employeeDetails.department) {
          const department = await Department.findById(employeeDetails.department).select('departmentName').lean();
          shift.employeeId.department = department || null; // Add department info to employeeId
        } else {
          shift.employeeId.department = null;
          console.warn(`No department found for employee ${shift.employeeId._id}`);
        }
      } else {
        console.warn(`Shift ${shift._id} has invalid employeeId`);
        shift.employeeId = { name: 'Unknown', email: 'N/A', role: 'N/A', department: null };
      }
    }

    // Filter shifts to ensure departmentId matches (as a fallback)
    const filteredShifts = departmentId
      ? shifts.filter(shift => {
          const matches = shift.employeeId?.department?._id?.toString() === departmentId;
          if (!matches) {
            console.warn(`Shift ${shift._id} does not match department ${departmentId}, employee department: ${shift.employeeId?.department?._id}`);
          }
          return matches;
        })
      : shifts;

    return res.status(200).json(filteredShifts);
  } catch (error) {
    console.error('Error fetching shifts:', error.stack);
    return res.status(500).json({
      message: 'Failed to fetch shifts.',
      error: error.message,
      stack: error.stack,
    });
  }
});

router.put('/shift-schedule/:id', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { startTime, endTime } = req.body;

    console.log('Updating shift schedule:', id, 'with:', JSON.stringify(req.body, null, 2));

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Validation failed: Invalid shift schedule ID');
      return res.status(400).json({ message: 'Invalid shift schedule ID.' });
    }
    if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      console.log('Validation failed: Invalid time format');
      return res.status(400).json({ message: 'Invalid time format.' });
    }

    const start = dayjs(`2025-01-01 ${startTime}`, 'YYYY-MM-DD HH:mm').utc();
    const end = dayjs(`2025-01-01 ${endTime}`, 'YYYY-MM-DD HH:mm').utc();
    if (start.isSame(end) || start.isAfter(end)) {
      console.log('Validation failed: Invalid time range');
      return res.status(400).json({ message: 'Start time must be before end time.' });
    }

    const shiftSchedule = await ShiftSchedule.findById(id);
    if (!shiftSchedule) {
      console.log('Shift schedule not found:', id);
      return res.status(404).json({ message: 'Shift schedule not found.' });
    }

    shiftSchedule.startTime = startTime;
    shiftSchedule.endTime = endTime;
    await shiftSchedule.save();

    console.log('Shift schedule updated successfully:', shiftSchedule._id);
    return res.status(200).json({ message: 'Shift schedule updated successfully.', data: shiftSchedule });
  } catch (error) {
    console.error('Error updating shift schedule:', error);
    return res.status(500).json({ message: 'Failed to update shift schedule.', error: error.message });
  }
});

// DELETE /shift-schedule/:id
router.delete('/shift-schedule/:id', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { id } = req.params;

    console.log('Deleting shift schedule:', id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Validation failed: Invalid shift schedule ID');
      return res.status(400).json({ message: 'Invalid shift schedule ID.' });
    }

    const shiftSchedule = await ShiftSchedule.findById(id);
    if (!shiftSchedule) {
      console.log('Shift schedule not found:', id);
      return res.status(404).json({ message: 'Shift schedule not found.' });
    }

    await shiftSchedule.deleteOne();
    console.log('Shift schedule deleted successfully:', id);
    return res.status(200).json({ message: 'Shift schedule deleted successfully.' });
  } catch (error) {
    console.error('Error deleting shift schedule:', error);
    return res.status(500).json({ message: 'Failed to delete shift schedule.', error: error.message });
  }
});
// GET /api/availability/shift-swap/available/:employeeId
router.get('/shift-swap/available/:employeeId', verifyUser, authorizeRoles(), async (req, res) => {
  try {
    const employeeId = req.params.employeeId;
    console.log('Employee ID:', employeeId); // Debug: Log the employeeId

    // Step 1: Fetch the requesting user
    const requestingUser = await User.findById(employeeId);
    if (!requestingUser) {
      console.log('User not found for employeeId:', employeeId);
      return res.status(404).json({ message: 'Employee not found.' });
    }

    if (requestingUser.role.toLowerCase() !== 'employee') {
      console.log('Unauthorized access for user:', requestingUser);
      return res.status(403).json({ message: 'Unauthorized. Only employees can access this.' });
    }

    const { companyId, departmentId } = requestingUser;
    console.log('Company ID:', companyId, 'Department ID:', departmentId); // Debug: Log company and department IDs

    // Step 2: Validate query parameters
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      console.log('Missing startDate or endDate:', { startDate, endDate });
      return res.status(400).json({ message: 'startDate and endDate are required.' });
    }

    // Step 3: Convert startDate to a Date object for querying
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

    // Step 4: Fetch the requesting employee's shifts
    const myShifts = await ShiftSchedule.find({
      employeeId,
      companyId,
      departmentId,
      weekStartDate: startDateObj,
    }).lean();
    console.log('My shifts:', myShifts); // Debug: Log the user's shifts

    // Step 5: Fetch colleagues in the same department
    const colleagues = await User.find({
      companyId,
      departmentId,
      _id: { $ne: employeeId },
      role: 'employee',
    }).select('_id name email').lean();
    console.log('Colleagues found:', colleagues); // Debug: Log colleagues

    // Step 6: Fetch shifts of colleagues
    const colleagueShifts = await ShiftSchedule.find({
      employeeId: { $in: colleagues.map((c) => c._id) },
      companyId,
      departmentId,
      weekStartDate: startDateObj,
    }).populate('employeeId', 'name email').lean();
    console.log('Colleague shifts:', colleagueShifts); // Debug: Log colleague shifts

    // Step 7: Filter out shifts that are identical to the requesting employee's shifts
    const availableShiftsForSwap = colleagueShifts.filter((colleagueShift) => {
      return !myShifts.some(
        (myShift) =>
          myShift.day === colleagueShift.day &&
          myShift.startTime === colleagueShift.startTime &&
          myShift.endTime === colleagueShift.endTime
      );
    });
    console.log('Available shifts for swap:', availableShiftsForSwap); // Debug: Log filtered shifts

    // Step 8: Check for existing swap requests
    const existingSwapRequests = await ShiftSwapRequest.find({
      shiftId: { $in: availableShiftsForSwap.map((shift) => shift._id) },
      employeeId,
      status: 'pending',
    }).lean();
    console.log('Existing swap requests:', existingSwapRequests); // Debug: Log existing swap requests

    const availableShifts = availableShiftsForSwap.filter(
      (shift) => !existingSwapRequests.some((req) => req.shiftId.toString() === shift._id.toString())
    );
    console.log('Final available shifts:', availableShifts); // Debug: Log final available shifts

    res.status(200).json(availableShifts);
  } catch (error) {
    console.error('Error in shift-swap/available:', error); // Debug: Log the full error
    res.status(500).json({ message: 'Server error while fetching available shifts.', error: error.message });
  }
});

export default router;