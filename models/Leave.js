import mongoose from "mongoose";

const leaveSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    leaveType: { type: String, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    description: { type: String },
    status: { type: String, default: "Pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Leave", leaveSchema);
