// backend/models/User.js
import mongoose from "mongoose";
import bcrypt from "bcrypt";

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["Admin", "Manager", "Employee"], required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
  resetPasswordToken: { type: String }, // Added for password reset
  resetPasswordExpires: { type: Date }, // Added for token expiration
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);
export default User;