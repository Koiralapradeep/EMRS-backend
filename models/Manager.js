import mongoose from 'mongoose';
import Holiday from './Holidays.js'; // Import the Holiday model

const managerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  holidays: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Holiday' }], // Reference Holiday
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Manager', managerSchema);