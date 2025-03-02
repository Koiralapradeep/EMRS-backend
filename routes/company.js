import express from "express";
import { createCompany,
        getCompanies,
        updateCompany,
        deleteCompany } from "../controller/companyController.js";
import { verifyUser, authorizeRoles } from "../middleware/authMiddleware.js";
import Company from '../models/Company.js';

const router = express.Router();

// Only Admins can create a company and assign a manager
router.post("/create", verifyUser, authorizeRoles(["Admin"]), createCompany);

// Only Admins can fetch companies
router.get("/", verifyUser, authorizeRoles(["Admin"]), getCompanies);

// Edit a company (Admin only)
router.put("/:id", verifyUser, authorizeRoles(["Admin"]), updateCompany);

// Delete a company (Admin only)
router.delete("/:id", verifyUser, authorizeRoles(["Admin"]), deleteCompany);


//fetch single company
router.get("/:id", verifyUser, authorizeRoles(["Admin"]), async (req, res) => {
    try {
      const { id } = req.params;
      console.log("Fetching company with ID:", id); // Debugging line
  
      if (!id || id.length !== 24) {
        return res.status(400).json({ success: false, error: "Invalid company ID format" });
      }
  
      const company = await Company.findById(id).populate("manager", "name email");
  
      if (!company) {
        return res.status(404).json({ success: false, error: "Company not found" });
      }
  
      res.status(200).json({ success: true, company });
    } catch (error) {
      console.error("Error fetching company details:", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  });
export default router;
