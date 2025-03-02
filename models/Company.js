import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    industry: { type: String, required: true },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null, // Default to null when the company is first created
      unique: false, // REMOVE unique constraint
    },
  },
  { timestamps: true }
);

const Company = mongoose.model("Company", CompanySchema);
export default Company;
