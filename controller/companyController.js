import Company from "../models/Company.js";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";

export const createCompany = async (req, res) => {
  try {
    console.log("DEBUG - Received Request:", req.body);

    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, error: "Only Admins can create companies." });
    }

    const { name, address, industry, managerEmail, managerName, managerPassword } = req.body;

    if (!name || !address || !industry || !managerEmail || !managerName || !managerPassword) {
      return res.status(400).json({ success: false, error: "All fields are required." });
    }

    // Check if the company already exists
    const existingCompany = await Company.findOne({ name });
    if (existingCompany) {
      return res.status(400).json({ success: false, error: "Company name already exists." });
    }

    // Create the company (manager will be assigned later)
    const newCompany = new Company({ name, address, industry, manager: null });
    await newCompany.save();
    console.log(" Company Created:", newCompany);

    // Check if manager already exists
    const existingManager = await User.findOne({ email: managerEmail });
    if (existingManager) {
      return res.status(400).json({ success: false, error: "Manager email already in use." });
    }

    // Hash manager password
    const bcrypt = await import("bcrypt");
    const hashedPassword = await bcrypt.hash(managerPassword, 10);

    // Create manager user
    const newManager = new User({
      name: managerName,
      email: managerEmail,
      password: hashedPassword,
      role: "Manager",
      companyId: newCompany._id,
    });

    await newManager.save();
    console.log("Manager Created:", newManager);

    // Assign the manager to the company
    newCompany.manager = newManager._id;
    await newCompany.save();
    console.log(" Manager Assigned to Company:", newCompany);

    res.status(201).json({
      success: true,
      message: "Company created successfully, and manager assigned.",
      company: newCompany,
      manager: newManager,
    });
  } catch (error) {
    console.error(" Error creating company:", error);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};
// Fetch all companies
// Fetch all companies (Admin only)
export const getCompanies = async (req, res) => {
  try {
    // Ensure only Admins can fetch companies
    if (req.user.role !== "Admin") {
      return res.status(403).json({
        success: false,
        error: "Only Admins can fetch companies.",
      });
    }

    // Fetch all companies and populate the manager field
    const companies = await Company.find().populate("manager", "name email");

    res.status(200).json({
      success: true,
      companies,
    });
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).json({ success: false, error: "Internal Server Error." });
  }
};

export const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Deleting company ID: ${id}`);

    // Find the company
    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({ success: false, error: "Company not found" });
    }

    // Delete the manager if assigned
    if (company.manager) {
      await User.findByIdAndDelete(company.manager);
      console.log("Deleted manager:", company.manager);
    }

    // Delete the company
    await Company.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: "Company deleted successfully" });
  } catch (error) {
    console.error("Error deleting company:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params; // Get company ID from URL
    const { name, address, industry, managerEmail } = req.body; // Updated fields

    console.log(`Updating company ID: ${id} with data:`, req.body);

    // Find the company by ID
    let company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({ success: false, error: "Company not found" });
    }

    // Update company details
    company.name = name || company.name;
    company.address = address || company.address;
    company.industry = industry || company.industry;

    // If a new manager email is provided, update manager
    if (managerEmail) {
      let existingManager = await User.findOne({ email: managerEmail });

      if (!existingManager) {
        return res.status(400).json({ success: false, error: "Manager not found" });
      }

      company.manager = existingManager._id;
    }

    // Save changes
    await company.save();

    res.status(200).json({ success: true, message: "Company updated successfully", company });
  } catch (error) {
    console.error("Error updating company:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};