import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["Manager", "Employee"], required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" }, // ✅ Link to Employee
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
