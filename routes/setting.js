import express from "express";
import { changePassword } from "../controller/settingController.js";
import { verifyUser } from "../middleware/authMiddleware.js";

const router = express.Router();

//  Secure Route: Change Password (Requires Auth)
router.put("/change-password", verifyUser, changePassword);

export default router;
