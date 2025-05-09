import mongoose from 'mongoose';

const slotSchema = new mongoose.Schema({
  startDay: {
    type: String,
    enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    required: true,
  },
  endDay: {
    type: String,
    enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    required: true,
  },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  shiftType: { type: String, enum: ['Day', 'Night'], required: true },
  minEmployees: { type: Number, required: true, min: 1 },
});

const shiftRequirementSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  sunday: [slotSchema],
  monday: [slotSchema],
  tuesday: [slotSchema],
  wednesday: [slotSchema],
  thursday: [slotSchema],
  friday: [slotSchema],
  saturday: [slotSchema],
});

const ShiftRequirement = mongoose.model('ShiftRequirement', shiftRequirementSchema);

export default mongoose.model('ShiftRequirement', shiftRequirementSchema);