import Company from "../models/Company.js";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import mongoose from "mongoose";
import crypto from "crypto";

// Set up Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify transporter configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Transporter Error:", error.message);
  } else {
    console.log("SMTP Transporter is ready to send emails.");
  }
});

export const createCompany = async (req, res) => {
  try {
    console.log("DEBUG - Received Request:", req.body);

    // Validate user role
    if (!req.user || req.user.role !== "Admin") {
      console.error("Unauthorized: User is not an Admin or not authenticated.", req.user);
      return res.status(403).json({ success: false, error: "Only Admins can create companies." });
    }

    const { name, address, industry, managerEmail, managerName, managerPassword } = req.body;

    // Validate required fields
    if (!name || !address || !industry || !managerEmail || !managerName || !managerPassword) {
      console.error("Validation failed: Missing required fields.", req.body);
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(managerEmail)) {
      console.error("Validation failed: Invalid manager email format:", managerEmail);
      return res.status(400).json({ success: false, error: "Invalid manager email format." });
    }

    // Validate password strength
    if (managerPassword.length < 6) {
      console.error("Validation failed: Password too short.", managerPassword);
      return res.status(400).json({ success: false, error: "Manager password must be at least 6 characters long." });
    }

    // Check if the company already exists
    const existingCompany = await Company.findOne({ name });
    if (existingCompany) {
      console.error("Validation failed: Company name already exists:", name);
      return res.status(400).json({ success: false, error: "Company name already exists." });
    }

    // Check if manager email is already in use
    const existingManager = await User.findOne({ email: managerEmail });
    if (existingManager) {
      console.error("Validation failed: Manager email already in use:", managerEmail);
      return res.status(400).json({ success: false, error: "Manager email already in use." });
    }

    // Create the company
    const newCompany = new Company({ name, address, industry, manager: null });
    await newCompany.save();
    console.log("Company Created:", { id: newCompany._id, name: newCompany.name });

    // Hash manager password
    const hashedPassword = await bcrypt.hash(managerPassword, 10);
    console.log("Password hashed for manager:", managerEmail);

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour expiry

    // Create manager user
    const newManager = new User({
      name: managerName,
      email: managerEmail,
      password: hashedPassword,
      role: "Manager",
      companyId: newCompany._id,
      resetPasswordToken: resetToken,
      resetPasswordExpires: resetTokenExpiry,
    });

    await newManager.save();
    console.log("Manager Created and Saved:", { id: newManager._id, name: newManager.name, email: newManager.email });

    // Verify manager exists in database
    const savedManager = await User.findById(newManager._id);
    if (!savedManager) {
      console.error("Error: Manager not found in database after save:", newManager._id);
      throw new Error("Failed to persist manager to database.");
    }

    // Assign the manager to the company
    newCompany.manager = newManager._id;
    await newCompany.save();
    console.log("Manager Assigned to Company:", { companyId: newCompany._id, managerId: newManager._id });

    // Send welcome email with reset link
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: `"EMRS Team" <${process.env.EMAIL_USER}>`,
      to: managerEmail,
      replyTo: process.env.EMAIL_USER,
      subject: "Welcome to EMRS - Set Your Password",
      html: `
        <p>Hello ${managerName},</p>
        <p>Welcome to EMRS! Your account has been created successfully.</p>
        <p>Please set your password by clicking <a href="${resetUrl}">here</a>.</p>
        <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
        <p>If you have any questions, please contact us at <a href="mailto:${process.env.EMAIL_USER}">${process.env.EMAIL_USER}</a>.</p>
        <p>Thank you,<br>EMRS Team</p>
        <hr>
        <p style="font-size: 12px; color: #777;">
          To stop receiving these emails, <a href="${process.env.FRONTEND_URL}/unsubscribe">click here to unsubscribe</a>.
        </p>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("Welcome email with reset link sent successfully to:", managerEmail);
    } catch (emailError) {
      console.error("Error sending welcome email to", managerEmail, ":", emailError.message);
      // Log the error but do not fail the request
    }

    res.status(201).json({
      success: true,
      message: "Company created successfully, and manager assigned. A password reset link has been sent to the manager's email.",
      company: newCompany,
      manager: { id: newManager._id, name: newManager.name, email: newManager.email },
    });
  } catch (error) {
    console.error("Error creating company:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};

export const getCompanies = async (req, res) => {
  try {
    // Validate user role
    if (!req.user || req.user.role !== "Admin") {
      console.error("Unauthorized: User is not an Admin or not authenticated.", req.user);
      return res.status(403).json({ success: false, error: "Only Admins can fetch companies." });
    }

    // Fetch all companies and populate the manager field
    const companies = await Company.find().populate("manager", "name email");
    console.log("Fetched companies:", companies.length);

    res.status(200).json({
      success: true,
      companies,
    });
  } catch (error) {
    console.error("Error fetching companies:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};

export const deleteCompany = async (req, res) => {
  try {
    console.log("DEBUG - Delete Request Received:", { params: req.params, headers: req.headers });

    const { id } = req.params;

    // Validate ObjectID
    if (!mongoose.isValidObjectId(id)) {
      console.error("Validation failed: Invalid company ID format:", id);
      return res.status(400).json({ success: false, error: "Invalid company ID format." });
    }

    // Validate user role
    if (!req.user || req.user.role !== "Admin") {
      console.error("Unauthorized: User is not an Admin or not authenticated.", req.user);
      return res.status(403).json({ success: false, error: "Only Admins can delete companies." });
    }

    console.log(`Attempting to delete company ID: ${id}`);

    // Find the company
    const company = await Company.findById(id);
    if (!company) {
      console.error("Company not found for ID:", id);
      return res.status(404).json({ success: false, error: "Company not found." });
    }
    console.log("Found company:", { id: company._id, name: company.name, manager: company.manager });

    // Delete the manager if assigned
    if (company.manager) {
      const manager = await User.findById(company.manager);
      if (manager) {
        await User.findByIdAndDelete(company.manager);
        console.log("Deleted manager with ID:", company.manager);
      } else {
        console.warn("Manager referenced but not found for ID:", company.manager);
      }
    } else {
      console.log("No manager assigned to company ID:", id);
    }

    // Delete the company
    const deletedCompany = await Company.findByIdAndDelete(id);
    if (!deletedCompany) {
      console.error("Failed to delete company for ID:", id);
      return res.status(500).json({ success: false, error: "Failed to delete company." });
    }
    console.log("Company deleted successfully for ID:", id);

    res.status(200).json({ success: true, message: "Company and associated manager deleted successfully." });
  } catch (error) {
    console.error("Error deleting company:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};

export const updateCompany = async (req, res) => {
  try {
    console.log("DEBUG - Update Request Received:", { params: req.params, body: req.body });

    const { id } = req.params;
    const { name, address, industry, managerEmail } = req.body;

    // Validate ObjectID
    if (!mongoose.isValidObjectId(id)) {
      console.error("Validation failed: Invalid company ID format:", id);
      return res.status(400).json({ success: false, error: "Invalid company ID format." });
    }

    // Validate user role
    if (!req.user || req.user.role !== "Admin") {
      console.error("Unauthorized: User is not an Admin or not authenticated.", req.user);
      return res.status(403).json({ success: false, error: "Only Admins can update companies." });
    }

    console.log(`Updating company ID: ${id} with data:`, req.body);

    // Find the company
    const company = await Company.findById(id);
    if (!company) {
      console.error("Company not found for ID:", id);
      return res.status(404).json({ success: false, error: "Company not found." });
    }

    // Validate unique company name if changed
    if (name && name !== company.name) {
      const existingCompany = await Company.findOne({ name });
      if (existingCompany) {
        console.error("Validation failed: Company name already exists:", name);
        return res.status(400).json({ success: false, error: "Company name already exists." });
      }
    }

    // Update company details
    company.name = name || company.name;
    company.address = address || company.address;
    company.industry = industry || company.industry;

    // Update manager if managerEmail is provided
    if (managerEmail) {
      const existingManager = await User.findOne({ email: managerEmail });
      if (!existingManager) {
        console.error("Validation failed: Manager not found for email:", managerEmail);
        return res.status(400).json({ success: false, error: "Manager not found." });
      }
      if (existingManager.role !== "Manager") {
        console.error("Validation failed: User is not a Manager for email:", managerEmail);
        return res.status(400).json({ success: false, error: "User is not a Manager." });
      }
      company.manager = existingManager._id;
      existingManager.companyId = company._id;
      await existingManager.save();
    }

    // Save changes
    await company.save();
    console.log("Company updated successfully for ID:", id);

    res.status(200).json({ success: true, message: "Company updated successfully.", company });
  } catch (error) {
    console.error("Error updating company:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};

export const getCompanyById = async (req, res) => {
  try {
    console.log("DEBUG - Get Company Request Received:", { params: req.params });

    const { id } = req.params;

    // Validate ObjectID
    if (!mongoose.isValidObjectId(id)) {
      console.error("Validation failed: Invalid company ID format:", id);
      return res.status(400).json({ success: false, error: "Invalid company ID format." });
    }

    // Validate user role
    if (!req.user || req.user.role !== "Admin") {
      console.error("Unauthorized: User is not an Admin or not authenticated.", req.user);
      return res.status(403).json({ success: false, error: "Only Admins can fetch company details." });
    }

    console.log("Fetching company with ID:", id);

    const company = await Company.findById(id).populate("manager", "name email");

    if (!company) {
      console.error("Company not found for ID:", id);
      return res.status(404).json({ success: false, error: "Company not found." });
    }

    res.status(200).json({ success: true, company });
  } catch (error) {
    console.error("Error fetching company details:", error.message);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};