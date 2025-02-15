import mongoose from "mongoose";

const leaveSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Reference to User
    leaveType: { type: String, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    description: { type: String },

    status: { type: String, default: "Pending" },
    appliedDate: { type: Date, default: Date.now },
    status: { 
      type: String, 
      enum:["Pending","Approved","Rejected"],
      default: "Pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Leave", leaveSchema);
