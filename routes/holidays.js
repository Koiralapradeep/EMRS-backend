import express from "express";
import Holiday from "../models/Holidays.js";
import { verifyUser, authorizeRoles } from "../middleware/authMiddleware.js";
import { startOfDay } from "date-fns"; // Import required function

const router = express.Router();

// POST route (updated to store dates as Date objects with correct year handling)
router.post("/", verifyUser, authorizeRoles(["Manager"]), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: "User is not associated with a company" });
    }

    const { startDate, endDate, name } = req.body;
    if (!startDate || !endDate || !name) {
      return res.status(400).json({ success: false, message: "Start date, end date, and name are required" });
    }

    // Parse dates (assuming input format "Wednesday 30 April")
    const parseDate = (dateStr) => {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const [dayName, day, month] = dateStr.split(" ");
      const monthIndex = months.indexOf(month);
      if (monthIndex === -1 || !days.includes(dayName) || !day) {
        throw new Error(`Invalid date format: ${dateStr}`);
      }
      // Use the current year initially, but rely on frontend validation to prevent past dates
      const year = new Date().getFullYear();
      const date = new Date(year, monthIndex, parseInt(day));
      return date;
    };

    const parsedStartDate = parseDate(startDate);
    const parsedEndDate = parseDate(endDate);
    const today = startOfDay(new Date());

    // Validation 1: Ensure startDate is not after endDate
    if (parsedEndDate < parsedStartDate) {
      return res.status(400).json({ success: false, message: "End date cannot be before start date" });
    }

    // Validation 2: Prevent past dates (rely on frontend validation, but add backend check as well)
    if (parsedStartDate < today) {
      return res.status(400).json({ success: false, message: "Start date cannot be in the past" });
    }

    // Validation 3: Check for overlapping date ranges
    const existingHolidays = await Holiday.find({ companyId });
    const newStart = parsedStartDate;
    const newEnd = parsedEndDate;

    const hasOverlap = existingHolidays.some((holiday) => {
      const existingStart = new Date(holiday.startDate);
      const existingEnd = new Date(holiday.endDate);
      return (
        (newStart >= existingStart && newStart <= existingEnd) ||
        (newEnd >= existingStart && newEnd <= existingEnd) ||
        (newStart <= existingStart && newEnd >= existingEnd)
      );
    });

    if (hasOverlap) {
      return res.status(400).json({ success: false, message: "Holiday date range overlaps with an existing holiday" });
    }

    const holiday = new Holiday({
      companyId,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      name,
    });

    await holiday.save();
    res.status(201).json({ success: true, holiday });
  } catch (error) {
    console.error("Error adding holiday:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET route (updated to work with Date objects)
router.get("/", verifyUser, authorizeRoles(["manager", "employee"]), async (req, res) => {
  try {
    if (!req.user) {
      console.error("No user found in request. Middleware may have failed.");
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      console.error("No companyId found for user:", req.user);
      return res.status(400).json({ success: false, message: "User is not associated with a company" });
    }

    console.log(`Fetching holidays for user: ${req.user.email}, Role: ${req.user.role}, Company ID: ${companyId}`);

    // Fetch all holidays for debugging
    const allHolidays = await Holiday.find({ companyId });
    console.log(`Total holidays found for company ${companyId}: ${allHolidays.length}`, {
      holidays: allHolidays.map((h) => ({
        id: h._id,
        startDate: h.startDate.toISOString(),
        endDate: h.endDate.toISOString(),
        name: h.name,
      })),
    });

    // Fetch upcoming holidays using MongoDB query
    const today = startOfDay(new Date());
    console.log(`Current date for filtering (UTC): ${today.toISOString()}`);
    const holidays = await Holiday.find({
      companyId,
      endDate: { $gte: today },
    }).sort({ startDate: 1 });

    console.log(`Found ${holidays.length} upcoming holidays for company ${companyId}`);

    const formattedHolidays = holidays.map((holiday) => ({
      id: holiday._id,
      startDate: holiday.startDate.toISOString(),
      endDate: holiday.endDate.toISOString(),
      name: holiday.name,
    }));

    res.status(200).json({
      success: true,
      holidays: formattedHolidays,
    });
  } catch (error) {
    console.error("Error fetching holidays:", error.message, error.stack);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;