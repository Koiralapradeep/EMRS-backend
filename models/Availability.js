import mongoose from 'mongoose';

const timeSlotSchema = new mongoose.Schema({
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  startDay: { type: String, required: true, enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] },
  endDay: { type: String, required: true, enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] },
  shiftType: { type: String, required: true, enum: ['Day', 'Night'] },
  preference: { type: Number, default: 0 } // Add preference field
});

const dayAvailabilitySchema = new mongoose.Schema({
  available: { type: Boolean, default: false },
  slots: [timeSlotSchema],
  note: { type: String, default: '' }
});

const availabilitySchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  weekStartDate: {
    type: Date,
    required: true
  },
  weekEndDate: {
    type: Date,
    required: true
  },
  days: {
    sunday: dayAvailabilitySchema,
    monday: dayAvailabilitySchema,
    tuesday: dayAvailabilitySchema,
    wednesday: dayAvailabilitySchema,
    thursday: dayAvailabilitySchema,
    friday: dayAvailabilitySchema,
    saturday: dayAvailabilitySchema
  },
  note: { type: String, default: '' },
  isRecurring: { type: Boolean, default: false },
  submittedAt: { type: Date, default: Date.now }
});

timeSlotSchema.pre('validate', function (next) {
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const startDayIdx = daysOfWeek.indexOf(this.startDay);
  const endDayIdx = daysOfWeek.indexOf(this.endDay);
  const startMinutes = parseInt(this.startTime.split(':')[0]) * 60 + parseInt(this.startTime.split(':')[1]);
  let endMinutes = parseInt(this.endTime.split(':')[0]) * 60 + parseInt(this.endTime.split(':')[1]);
  const adjustedEndMinutes = endDayIdx < startDayIdx || (endDayIdx === startDayIdx && endMinutes <= startMinutes) ? endMinutes + 24 * 60 : endMinutes;

  if (startMinutes === adjustedEndMinutes && this.startDay === this.endDay) {
    throw new Error('Start time and end time cannot be the same on the same day.');
  }

  const [startHour, startMinute] = this.startTime.split(':').map(Number);
  const [endHour, endMinute] = this.endTime.split(':').map(Number);
  if (startMinute % 30 !== 0 || endMinute % 30 !== 0) {
    throw new Error('Time slots must be in 30-minute increments.');
  }
  next();
});

availabilitySchema.pre('save', function (next) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const daysOfWeekIndices = days.reduce((acc, day, idx) => {
    acc[day] = idx;
    return acc;
  }, {});

  days.forEach(day => {
    const slots = this.days[day].slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const startDayIdx = daysOfWeekIndices[slot.startDay];
      const endDayIdx = daysOfWeekIndices[slot.endDay];
      const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
      let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
      const adjustedEndMinutes = endDayIdx < startDayIdx || (endDayIdx === startDayIdx && endMinutes <= startMinutes) ? endMinutes + 24 * 60 : endMinutes;

      for (let j = 0; j < slots.length; j++) {
        if (i === j) continue;
        const otherSlot = slots[j];
        if (slot.startDay !== otherSlot.startDay) continue;
        const otherStartMinutes = parseInt(otherSlot.startTime.split(':')[0]) * 60 + parseInt(otherSlot.startTime.split(':')[1]);
        let otherEndMinutes = parseInt(otherSlot.endTime.split(':')[0]) * 60 + parseInt(otherSlot.endTime.split(':')[1]);
        const otherAdjustedEndMinutes = otherSlot.endDay < otherSlot.startDay || (otherSlot.endDay === otherSlot.startDay && otherEndMinutes <= otherStartMinutes) ? otherEndMinutes + 24 * 60 : otherEndMinutes;

        if (
          (startMinutes > otherStartMinutes && startMinutes < otherAdjustedEndMinutes) ||
          (adjustedEndMinutes > otherStartMinutes && adjustedEndMinutes < otherAdjustedEndMinutes) ||
          (startMinutes <= otherStartMinutes && adjustedEndMinutes >= otherAdjustedEndMinutes)
        ) {
          throw new Error(`Overlapping time slots on ${day}.`);
        }
      }

      const totalHours = slots.reduce((sum, slot) => {
        const startMinutes = parseInt(slot.startTime.split(':')[0]) * 60 + parseInt(slot.startTime.split(':')[1]);
        let endMinutes = parseInt(slot.endTime.split(':')[0]) * 60 + parseInt(slot.endTime.split(':')[1]);
        const adjustedEndMinutes = slot.endDay < slot.startDay || (slot.endDay === slot.startDay && endMinutes <= startMinutes) ? endMinutes + 24 * 60 : endMinutes;
        return sum + (adjustedEndMinutes - startMinutes) / 60;
      }, 0);
      if (totalHours > 12) {
        throw new Error(`Total availability on ${day} exceeds 12 hours.`);
      }
    }
  });
  next();
});

availabilitySchema.pre('save', function (next) {
  const start = new Date(this.weekStartDate);
  const end = new Date(this.weekEndDate);
  const diffDays = (end - start) / (1000 * 60 * 60 * 24);
  if (diffDays !== 6) {
    throw new Error('weekEndDate must be exactly 6 days after weekStartDate.');
  }
  next();
});

availabilitySchema.index({ employeeId: 1, weekStartDate: 1 }, { unique: true });
availabilitySchema.index({ companyId: 1, weekStartDate: 1 });

const availabilityHistorySchema = new mongoose.Schema({
  availabilityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Availability'
  },
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  weekStartDate: { type: Date, required: true },
  action: { type: String, enum: ['created', 'updated', 'deleted'], required: true },
  data: { type: mongoose.Schema.Types.Mixed },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  performedAt: { type: Date, default: Date.now }
});

const Availability = mongoose.model('Availability', availabilitySchema);
const AvailabilityHistory = mongoose.model('AvailabilityHistory', availabilityHistorySchema);

export { Availability, AvailabilityHistory };