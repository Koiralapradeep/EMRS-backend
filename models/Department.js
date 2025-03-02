import mongoose from "mongoose";

const departmentSchema = new mongoose.Schema(
  {
    departmentName: {
      type: String,
      required: [true, "Department name is required"],
      trim: true,
    },
    departmentCode: {
      type: String,
      required: [true, "Department code is required"],
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company", // Ensure department belongs to a company
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Department", departmentSchema);
