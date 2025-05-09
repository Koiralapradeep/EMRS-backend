import express from "express";
import {
  createCompany,
  getCompanies,
  updateCompany,
  deleteCompany,
  getCompanyById,
} from "../controller/companyController.js";
import { verifyUser, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Only Admins can create a company and assign a manager
router.post("/create", verifyUser, authorizeRoles(["Admin"]), createCompany);

// Only Admins can fetch all companies
router.get("/", verifyUser, authorizeRoles(["Admin"]), getCompanies);

// Only Admins can fetch a single company
router.get("/:id", verifyUser, authorizeRoles(["Admin"]), getCompanyById);

// Only Admins can update a company
router.put("/:id", verifyUser, authorizeRoles(["Admin"]), updateCompany);

// Only Admins can delete a company
router.delete("/:id", verifyUser, authorizeRoles(["Admin"]), deleteCompany);

export default router;