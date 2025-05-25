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
import { AvailabilityMatcher } from '../Util/AvailabilityMatcher.js';
import { SchedulingOptimizer, SchedulingCoordinator } from '../Util/SchedulingOptimizer.js';
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

// Enhanced scheduling algorithm that works for ANY scenario
const generateUniversalSchedule = async (companyId, departmentId, startDate, shiftRequirements, availabilities) => {
  const shifts = [];
  const employeeHours = {};
  const employeeAssignments = {};
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  console.log('=== Starting Universal Scheduling ===');
  console.log(`Processing ${availabilities.length} employees for ${shiftRequirements.length} shift requirement sets`);

  // Helper function to convert time to minutes
  const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Helper function to convert minutes to time
  const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  // Process each day independently
  for (let dayIndex = 0; dayIndex < daysOfWeek.length; dayIndex++) {
    const day = daysOfWeek[dayIndex];
    console.log(`\n=== Processing ${day.toUpperCase()} ===`);

    // Reset daily assignments to prevent double-booking on same day
    const dailyAssignedEmployees = new Set();

    // Get all shift requirements for this day
    const dayRequirements = [];
    for (const requirement of shiftRequirements) {
      const daySlots = requirement[day] || [];
      daySlots.forEach(slot => {
        dayRequirements.push({
          ...slot,
          departmentId: requirement.departmentId,
          day: day
        });
      });
    }

    if (dayRequirements.length === 0) {
      console.log(`No shift requirements for ${day}`);
      continue;
    }

    // Sort requirements by start time to process in chronological order
    dayRequirements.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    console.log(`Found ${dayRequirements.length} shift requirements for ${day}:`);
    dayRequirements.forEach((req, i) => {
      console.log(`  ${i + 1}. ${req.startTime}-${req.endTime} (${req.minEmployees} employees needed)`);
    });

    // Process each shift requirement
    for (let reqIndex = 0; reqIndex < dayRequirements.length; reqIndex++) {
      const shiftReq = dayRequirements[reqIndex];
      console.log(`\nProcessing shift ${reqIndex + 1}: ${shiftReq.startTime}-${shiftReq.endTime}`);

      const reqStartMinutes = timeToMinutes(shiftReq.startTime);
      let reqEndMinutes = timeToMinutes(shiftReq.endTime);
      
      // Handle overnight shifts (end time before start time)
      if (reqEndMinutes <= reqStartMinutes) {
        reqEndMinutes += 24 * 60; // Add 24 hours
      }

      const shiftDurationMinutes = reqEndMinutes - reqStartMinutes;
      const shiftDurationHours = shiftDurationMinutes / 60;

      console.log(`Shift details: ${shiftDurationHours} hours (${reqStartMinutes}-${reqEndMinutes} minutes)`);

      // Find ALL employees available for this specific shift
      const availableEmployees = [];

      for (const avail of availabilities) {
        const employeeId = avail.employeeId._id.toString();
        
        // Skip if employee already assigned today
        if (dailyAssignedEmployees.has(employeeId)) {
          console.log(`Skipping ${avail.employeeId.name}: already assigned today`);
          continue;
        }

        const dayAvailability = avail.days[day];
        if (!dayAvailability || !dayAvailability.available) {
          console.log(`Skipping ${avail.employeeId.name}: not available on ${day}`);
          continue;
        }

        console.log(`Checking ${avail.employeeId.name} for ${day}`);

        // Check each availability slot for this employee
        for (const availSlot of dayAvailability.slots) {
          const availStartMinutes = timeToMinutes(availSlot.startTime);
          let availEndMinutes = timeToMinutes(availSlot.endTime);
          
          // Handle overnight availability
          if (availEndMinutes <= availStartMinutes) {
            availEndMinutes += 24 * 60;
          }

          console.log(`  Availability slot: ${availSlot.startTime}-${availSlot.endTime} (${availStartMinutes}-${availEndMinutes})`);

          // Calculate overlap between requirement and availability
          const overlapStart = Math.max(reqStartMinutes, availStartMinutes);
          const overlapEnd = Math.min(reqEndMinutes, availEndMinutes);

          if (overlapStart < overlapEnd) {
            const overlapMinutes = overlapEnd - overlapStart;
            const overlapHours = overlapMinutes / 60;
            const coveragePercentage = (overlapMinutes / shiftDurationMinutes) * 100;

            console.log(`    Overlap: ${overlapMinutes} minutes (${coveragePercentage.toFixed(1)}% coverage)`);

            // Accept any meaningful overlap (even partial coverage)
            if (overlapMinutes >= 30) { // At least 30 minutes
              const currentHours = employeeHours[employeeId] || 0;
              
              availableEmployees.push({
                employeeId,
                employee: avail.employeeId,
                overlapStart,
                overlapEnd,
                overlapMinutes,
                overlapHours,
                coveragePercentage,
                currentHours,
                preference: availSlot.preference || 0,
                actualStartTime: minutesToTime(overlapStart),
                actualEndTime: minutesToTime(overlapEnd % (24 * 60)),
                durationHours: overlapHours,
                isExactMatch: coveragePercentage >= 95
              });

              console.log(`    Added candidate: ${avail.employeeId.name} ${minutesToTime(overlapStart)}-${minutesToTime(overlapEnd % (24 * 60))} (${overlapHours.toFixed(2)}h)`);
            } else {
              console.log(`    Overlap too small: ${overlapMinutes} minutes`);
            }
          } else {
            console.log(`    No overlap: req(${reqStartMinutes}-${reqEndMinutes}) vs avail(${availStartMinutes}-${availEndMinutes})`);
          }
        }
      }

      console.log(`Found ${availableEmployees.length} available employees for this shift`);

      if (availableEmployees.length === 0) {
        console.warn(`No employees available for ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);
        continue;
      }

      // Sort employees by priority:
      // 1. Exact matches first (95%+ coverage)
      // 2. Higher coverage percentage
      // 3. Lower current hours (fairness)
      // 4. Higher preference
      availableEmployees.sort((a, b) => {
        // Exact matches get highest priority
        if (a.isExactMatch && !b.isExactMatch) return -1;
        if (!a.isExactMatch && b.isExactMatch) return 1;
        
        // Then by coverage percentage
        const coverageDiff = b.coveragePercentage - a.coveragePercentage;
        if (Math.abs(coverageDiff) > 5) return coverageDiff;
        
        // Then by fairness (fewer hours is better)
        const hoursDiff = a.currentHours - b.currentHours;
        if (Math.abs(hoursDiff) > 1) return hoursDiff;
        
        // Finally by preference
        return b.preference - a.preference;
      });

      console.log('Ranked candidates:');
      availableEmployees.slice(0, 5).forEach((emp, i) => {
        console.log(`  ${i + 1}. ${emp.employee.name}: ${emp.actualStartTime}-${emp.actualEndTime} (${emp.coveragePercentage.toFixed(1)}%, ${emp.currentHours}h current)`);
      });

      // Assign employees to this shift
      const assignmentsNeeded = shiftReq.minEmployees;
      const assignments = [];

      // Strategy 1: If we have exact matches, use them first
      const exactMatches = availableEmployees.filter(emp => emp.isExactMatch);
      if (exactMatches.length > 0) {
        console.log(`Using ${Math.min(assignmentsNeeded, exactMatches.length)} exact matches`);
        for (let i = 0; i < Math.min(assignmentsNeeded, exactMatches.length); i++) {
          assignments.push(exactMatches[i]);
        }
      } else {
        // Strategy 2: Use best available employees up to the required number
        console.log(`No exact matches, using top ${Math.min(assignmentsNeeded, availableEmployees.length)} candidates`);
        for (let i = 0; i < Math.min(assignmentsNeeded, availableEmployees.length); i++) {
          assignments.push(availableEmployees[i]);
        }
      }

      // Create and save shift records
      for (const assignment of assignments) {
        const employeeIdStr = assignment.employeeId;
        
        const shift = new ShiftSchedule({
          employeeId: assignment.employeeId,
          companyId,
          departmentId: shiftReq.departmentId,
          weekStartDate: startDate,
          day,
          startTime: assignment.actualStartTime,
          endTime: assignment.actualEndTime,
          durationHours: assignment荣誉Hours
        });

        console.log(`Creating shift: ${assignment.employee.name} ${assignment.actualStartTime}-${assignment.actualEndTime} (${assignment.durationHours.toFixed(2)}h)`);
        
        try {
          await shift.save();
          shifts.push(shift);

          // Update tracking
          employeeHours[employeeIdStr] = (employeeHours[employeeIdStr] || 0) + assignment.durationHours;
          dailyAssignedEmployees.add(employeeIdStr);

          if (!employeeAssignments[employeeIdStr]) {
            employeeAssignments[employeeIdStr] = {
              employee: assignment.employee,
              shifts: []
            };
          }
          employeeAssignments[employeeIdStr].shifts.push(shift);

          console.log(`✓ Saved shift for ${assignment.employee.name}`);
        } catch (error) {
          console.error(`Failed to save shift for ${assignment.employee.name}:`, error);
        }
      }

      console.log(`Assigned ${assignments.length}/${assignmentsNeeded} employees to this shift`);
    }
  }

  console.log('\n=== Scheduling Summary ===');
  console.log(`Total shifts created: ${shifts.length}`);
  console.log(`Employees with assignments: ${Object.keys(employeeAssignments).length}`);
  
  // Log employee hour distribution
  console.log('\nEmployee Hours:');
  Object.entries(employeeHours).forEach(([empId, hours]) => {
    const empName = employeeAssignments[empId]?.employee?.name || 'Unknown';
    console.log(`  ${empName}: ${hours.toFixed(2)} hours`);
  });

  return {
    shifts,
    employeeHours,
    employeeAssignments
  };
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
// Complete Integration - Enhanced Auto-Schedule System
//auto-schedule:
router.post('/auto-schedule/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { startDate, endDate, departmentId } = req.body;
    
    console.log('Auto-schedule request:', { companyId, startDate, endDate, departmentId });

    // Basic validation
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ message: 'Invalid companyId.' });
    }
    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid departmentId.' });
    }

    const start = dayjs.utc(startDate).startOf('day');
    const end = dayjs.utc(endDate).startOf('day');

    if (start.day() !== 0 || end.day() !== 6 || end.diff(start, 'day') !== 6) {
      return res.status(400).json({ message: 'Date range must be from Sunday to Saturday.' });
    }

    // Add validation for startDate to prevent scheduling before the current week
    const today = dayjs().utc();
    const currentWeekStart = today.subtract(today.day(), 'day');
    if (start.isBefore(currentWeekStart, 'day')) {
      return res.status(400).json({ message: 'Cannot generate schedule for past weeks.' });
    }

    // Check department exists
    const department = await Department.findOne({ _id: departmentId, companyId }).lean();
    if (!department) {
      return res.status(400).json({ message: 'Department not found.' });
    }

    // Check for existing shifts
    const existingShifts = await ShiftSchedule.find({
      companyId,
      weekStartDate: start.toDate(),
      departmentId,
    }).lean();

    if (existingShifts.length > 0) {
      return res.status(400).json({ 
        message: 'Schedule already exists. Delete existing shifts first.',
        existingShiftsCount: existingShifts.length
      });
    }

    // Get shift requirements
    const shiftRequirements = await ShiftRequirement.find({ companyId, departmentId }).lean();
    if (!shiftRequirements || shiftRequirements.length === 0) {
      return res.status(400).json({ message: 'No shift requirements found.' });
    }

    // Validate shift requirements have actual slots
    const hasValidSlots = shiftRequirements.some(req => 
      ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        .some(day => req[day] && req[day].length > 0)
    );

    if (!hasValidSlots) {
      return res.status(400).json({ message: 'No time slots defined in shift requirements.' });
    }

    // Get availabilities
    let availabilities = await Availability.find({
      companyId,
      weekStartDate: start.toDate(),
    }).populate({
      path: 'employeeId',
      select: 'name email role',
    }).lean();

    if (!availabilities || availabilities.length === 0) {
      return res.status(400).json({ message: 'No employee availabilities found.' });
    }

    // Filter by department
    const validAvailabilities = [];
    for (const avail of availabilities) {
      if (avail.employeeId && avail.employeeId._id) {
        const employeeDetails = await Employee.findOne({ userId: avail.employeeId._id }).select('department').lean();
        if (employeeDetails && employeeDetails.department && employeeDetails.department.toString() === departmentId.toString()) {
          avail.employeeId.departmentId = employeeDetails.department;
          validAvailabilities.push(avail);
        }
      }
    }

    if (validAvailabilities.length === 0) {
      return res.status(400).json({ message: 'No employees from this department have submitted availability.' });
    }

    console.log(`Processing ${validAvailabilities.length} employees`);

    // Enhanced scheduling algorithm
    const shifts = [];
    const employeeHours = {};
    const employeeAssignments = {};
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Helper functions
    const timeToMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const minutesToTime = (minutes) => {
      const hours = Math.floor(minutes / 60) % 24;
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };

    // Process each day
    for (let dayIndex = 0; dayIndex < daysOfWeek.length; dayIndex++) {
      const day = daysOfWeek[dayIndex];
      console.log(`\n=== Processing ${day.toUpperCase()} ===`);

      // Track employee assignments for this day (but allow multiple shifts)
      const employeeShiftTimes = {}; // Track specific time slots to prevent exact duplicates

      // Get shift requirements for this day
      const dayRequirements = [];
      for (const requirement of shiftRequirements) {
        const daySlots = requirement[day] || [];
        daySlots.forEach(slot => {
          dayRequirements.push({
            ...slot,
            departmentId: requirement.departmentId,
            day: day
          });
        });
      }

      if (dayRequirements.length === 0) {
        console.log(`No shift requirements for ${day}`);
        continue;
      }

      // Sort by start time
      dayRequirements.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

      console.log(`Found ${dayRequirements.length} shift requirements for ${day}:`);
      dayRequirements.forEach((req, i) => {
        console.log(`  ${i + 1}. ${req.startTime}-${req.endTime} (${req.minEmployees} employees)`);
      });

      // Process each shift requirement
      for (const shiftReq of dayRequirements) {
        console.log(`\nProcessing shift: ${shiftReq.startTime}-${shiftReq.endTime}`);

        const reqStartMinutes = timeToMinutes(shiftReq.startTime);
        let reqEndMinutes = timeToMinutes(shiftReq.endTime);
        
        // Handle overnight shifts
        if (reqEndMinutes <= reqStartMinutes) {
          reqEndMinutes += 24 * 60;
        }

        const shiftDurationMinutes = reqEndMinutes - reqStartMinutes;
        const shiftDurationHours = shiftDurationMinutes / 60;

        console.log(`Shift details: ${shiftDurationHours} hours (${reqStartMinutes}-${reqEndMinutes} minutes)`);

        // Find available employees
        const candidates = [];

        for (const avail of validAvailabilities) {
          const employeeId = avail.employeeId._id.toString();
          
          // Check if employee already has THIS EXACT shift time
          const shiftKey = `${shiftReq.startTime}-${shiftReq.endTime}`;
          if (employeeShiftTimes[employeeId]?.includes(shiftKey)) {
            console.log(`Skipping ${avail.employeeId.name}: already has this exact shift time`);
            continue;
          }

          const dayAvailability = avail.days[day];
          if (!dayAvailability || !dayAvailability.available) {
            console.log(`Skipping ${avail.employeeId.name}: not available on ${day}`);
            continue;
          }

          console.log(`Checking ${avail.employeeId.name} for ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);

          // Check each availability slot
          for (const availSlot of dayAvailability.slots || []) {
            const availStartMinutes = timeToMinutes(availSlot.startTime);
            let availEndMinutes = timeToMinutes(availSlot.endTime);
            
            // Handle overnight availability
            if (availEndMinutes <= availStartMinutes) {
              availEndMinutes += 24 * 60;
            }

            console.log(`  Available: ${availSlot.startTime}-${availSlot.endTime} (${availStartMinutes}-${availEndMinutes})`);
            console.log(`  Required: ${shiftReq.startTime}-${shiftReq.endTime} (${reqStartMinutes}-${reqEndMinutes})`);

            // Calculate overlap
            const overlapStart = Math.max(reqStartMinutes, availStartMinutes);
            const overlapEnd = Math.min(reqEndMinutes, availEndMinutes);

            if (overlapStart < overlapEnd) {
              const overlapMinutes = overlapEnd - overlapStart;
              const overlapHours = overlapMinutes / 60;
              const coveragePercentage = (overlapMinutes / shiftDurationMinutes) * 100;

              console.log(`    Overlap: ${overlapMinutes} minutes (${coveragePercentage.toFixed(1)}% coverage)`);

              // Accept meaningful overlap (at least 30 minutes)
              if (overlapMinutes >= 30) {
                const currentHours = employeeHours[employeeId] || 0;
                
                candidates.push({
                  employeeId,
                  employee: avail.employeeId,
                  overlapStart,
                  overlapEnd,
                  overlapHours,
                  coveragePercentage,
                  currentHours,
                  actualStartTime: minutesToTime(overlapStart),
                  actualEndTime: minutesToTime(overlapEnd % (24 * 60)),
                  isExactMatch: coveragePercentage >= 95,
                  shiftKey
                });

                console.log(`    ✓ Added candidate: ${avail.employeeId.name} ${minutesToTime(overlapStart)}-${minutesToTime(overlapEnd % (24 * 60))} (${overlapHours.toFixed(2)}h, ${coveragePercentage.toFixed(1)}%)`);
              } else {
                console.log(`    ✗ Overlap too small: ${overlapMinutes} minutes`);
              }
            } else {
              console.log(`    ✗ No overlap`);
            }
          }
        }

        console.log(`Found ${candidates.length} candidates for ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);

        if (candidates.length === 0) {
          console.warn(`No candidates available for ${day} ${shiftReq.startTime}-${shiftReq.endTime}`);
          continue;
        }

        // Sort candidates: exact matches first, then by coverage, then by fairness
        candidates.sort((a, b) => {
          // Exact matches get priority
          if (a.isExactMatch && !b.isExactMatch) return -1;
          if (!a.isExactMatch && b.isExactMatch) return 1;
          
          // Then by coverage percentage
          const coverageDiff = b.coveragePercentage - a.coveragePercentage;
          if (Math.abs(coverageDiff) > 5) return coverageDiff;
          
          // Then by fairness (fewer current hours is better)
          const hoursDiff = a.currentHours - b.currentHours;
          if (Math.abs(hoursDiff) > 1) return hoursDiff;
          
          return 0;
        });

        console.log(`Top candidates:`);
        candidates.slice(0, 3).forEach((candidate, i) => {
          console.log(`  ${i + 1}. ${candidate.employee.name}: ${candidate.actualStartTime}-${candidate.actualEndTime} (${candidate.coveragePercentage.toFixed(1)}%, ${candidate.currentHours}h current)`);
        });

        // Assign employees to this shift
        const assignmentsNeeded = Math.min(shiftReq.minEmployees, candidates.length);
        
        for (let i = 0; i < assignmentsNeeded; i++) {
          const assignment = candidates[i];
          const employeeIdStr = assignment.employeeId;
          
          try {
            const shift = new ShiftSchedule({
              employeeId: assignment.employeeId,
              companyId,
              departmentId: shiftReq.departmentId,
              weekStartDate: start.toDate(),
              day,
              startTime: assignment.actualStartTime,
              endTime: assignment.actualEndTime,
              durationHours: assignment.overlapHours
            });

            await shift.save();
            shifts.push(shift);

            // Update tracking
            employeeHours[employeeIdStr] = (employeeHours[employeeIdStr] || 0) + assignment.overlapHours;
            
            // Track this specific shift time for this employee
            if (!employeeShiftTimes[employeeIdStr]) {
              employeeShiftTimes[employeeIdStr] = [];
            }
            employeeShiftTimes[employeeIdStr].push(assignment.shiftKey);

            if (!employeeAssignments[employeeIdStr]) {
              employeeAssignments[employeeIdStr] = {
                employee: assignment.employee,
                shifts: []
              };
            }
            employeeAssignments[employeeIdStr].shifts.push(shift);

            console.log(`✓ ASSIGNED: ${assignment.employee.name} to ${assignment.actualStartTime}-${assignment.actualEndTime} (${assignment.overlapHours.toFixed(2)}h)`);
            console.log(`  Total hours for ${assignment.employee.name}: ${employeeHours[employeeIdStr].toFixed(2)}h`);
          } catch (error) {
            console.error(`Failed to save shift for ${assignment.employee.name}:`, error);
          }
        }

        console.log(`Completed shift assignment: ${assignmentsNeeded} employees assigned`);
      }

      console.log(`\nCompleted ${day}. Employee hours so far:`);
      Object.entries(employeeHours).forEach(([empId, hours]) => {
        const empName = employeeAssignments[empId]?.employee?.name || 'Unknown';
        console.log(`  ${empName}: ${hours.toFixed(2)}h`);
      });
    }

    console.log(`\n=== Final Summary ===`);
    console.log(`Generated ${shifts.length} total shifts`);

    if (shifts.length === 0) {
      return res.status(400).json({ message: 'Unable to generate any shifts.' });
    }

    // Send email notifications
    for (const employeeId in employeeAssignments) {
      const { employee, shifts: employeeShifts } = employeeAssignments[employeeId];
      try {
        await sendScheduleEmail(employee, employeeShifts, start);
        console.log(`Email sent to ${employee.email}`);
      } catch (emailError) {
        console.error(`Email failed for ${employee.email}:`, emailError.message);
      }
    }

    // Calculate metrics
    const fairnessMetrics = {
      totalHours: Object.values(employeeHours).reduce((sum, hours) => sum + hours, 0),
      shiftsAssigned: shifts.length,
      employeesAssigned: Object.keys(employeeAssignments).length,
      averageHoursPerEmployee: Object.keys(employeeHours).length > 0 
        ? Object.values(employeeHours).reduce((sum, hours) => sum + hours, 0) / Object.keys(employeeHours).length 
        : 0,
      hourDistribution: employeeHours
    };

    console.log('Final employee hours:', fairnessMetrics.hourDistribution);

    return res.status(200).json({
      shifts,
      fairnessMetricsByDept: { [departmentId]: fairnessMetrics },
      summary: {
        totalShifts: shifts.length,
        employeesScheduled: Object.keys(employeeAssignments).length,
        averageHours: fairnessMetrics.averageHoursPerEmployee.toFixed(2)
      }
    });

  } catch (error) {
    console.error('Auto-schedule error:', error);
    return res.status(500).json({
      message: 'Failed to generate schedule.',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


// POST /shift-schedule: Add a new shift with overlap validation
router.post('/schedule/:companyId', verifyUser, authorizeRoles(['Manager']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { 
      employeeId, 
      day, 
      startTime, 
      endTime, 
      weekStartDate, 
      departmentId, 
      note,
      durationHours // Accept durationHours from frontend
    } = req.body;

    console.log('Creating manual shift for company:', companyId);
    console.log('Request body:', req.body);

    // Validate required fields
    if (!employeeId || !day || !startTime || !endTime || !weekStartDate || !departmentId) {
      return res.status(400).json({ 
        message: 'Missing required fields for manual shift creation.',
        missingFields: {
          employeeId: !employeeId,
          day: !day,
          startTime: !startTime,
          endTime: !endTime,
          weekStartDate: !weekStartDate,
          departmentId: !departmentId
        }
      });
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: 'Invalid employeeId format.' });
    }
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ message: 'Invalid companyId format.' });
    }
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({ message: 'Invalid departmentId format.' });
    }

    // Calculate duration if not provided
    let calculatedDurationHours = durationHours;
    if (!calculatedDurationHours) {
      const [startHours, startMinutes] = startTime.split(':').map(Number);
      const [endHours, endMinutes] = endTime.split(':').map(Number);
      
      const startTotalMinutes = startHours * 60 + startMinutes;
      let endTotalMinutes = endHours * 60 + endMinutes;
      
      // Handle overnight shifts
      if (endTotalMinutes <= startTotalMinutes) {
        endTotalMinutes += 24 * 60;
      }
      
      const durationMinutes = endTotalMinutes - startTotalMinutes;
      calculatedDurationHours = durationMinutes / 60;
    }

    // Validate duration
    if (!calculatedDurationHours || calculatedDurationHours <= 0) {
      return res.status(400).json({ message: 'Invalid shift duration. Duration must be greater than 0.' });
    }

    // Parse weekStartDate
    const weekStartDateObj = new Date(weekStartDate);
    if (isNaN(weekStartDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid weekStartDate format.' });
    }

    // Check if employee already has a shift at this time
    const existingShift = await ShiftSchedule.findOne({
      employeeId,
      day,
      weekStartDate: weekStartDateObj,
      $or: [
        {
          $and: [
            { startTime: { $lt: endTime } },
            { endTime: { $gt: startTime } }
          ]
        }
      ]
    });

    if (existingShift) {
      return res.status(409).json({ 
        message: 'No available space for this shift. Employee already has a conflicting shift at this time.',
        conflict: {
          existingShift: {
            day: existingShift.day,
            startTime: existingShift.startTime,
            endTime: existingShift.endTime
          }
        }
      });
    }

    // Verify employee exists and belongs to the company
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }
    if (employee.companyId.toString() !== companyId) {
      return res.status(400).json({ message: 'Employee does not belong to this company.' });
    }

    // Verify department exists and belongs to the company
    const department = await Department.findOne({ _id: departmentId, companyId });
    if (!department) {
      return res.status(404).json({ message: 'Department not found or does not belong to this company.' });
    }

    // Create the manual shift with all required fields
    const newShift = new ShiftSchedule({
      employeeId,
      companyId, // Include companyId as required by schema
      departmentId,
      weekStartDate: weekStartDateObj,
      day,
      startTime,
      endTime,
      durationHours: Number(calculatedDurationHours.toFixed(2)) // Include durationHours as required by schema
    });

    console.log('Creating shift with data:', {
      employeeId,
      companyId,
      departmentId,
      weekStartDate: weekStartDateObj,
      day,
      startTime,
      endTime,
      durationHours: calculatedDurationHours
    });

    await newShift.save();
    
    // Populate the employee data for the response
    await newShift.populate('employeeId', 'name email role');

    console.log('Manual shift created successfully:', newShift._id);
    
    res.status(201).json({
      message: 'Manual shift created successfully',
      shift: newShift
    });

  } catch (error) {
    console.error('Error creating manual shift:', error);
    
    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        error: error.message,
        validationErrors
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(409).json({ 
        message: 'Duplicate shift detected', 
        error: 'A shift with these details already exists'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to create manual shift', 
      error: error.message 
    });
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