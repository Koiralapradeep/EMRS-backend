import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Company' },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true }, 
  name: { type: String, required: true }, 
  createdAt: { type: Date, default: Date.now }
});

const Holiday = mongoose.model("Holiday", holidaySchema);
export default Holiday;