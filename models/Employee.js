import mongoose from 'mongoose';

// Employee Schema
const employeeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company', //  Ensure employee belongs to a company
      required: true,
    },
    employeeID: {
      type: String,
      required: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    dob: {
      type: Date,
      required: true,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: true,
    },
    maritalStatus: {
      type: String,
      enum: ['Single', 'Married'],
      required: true,
    },
    designation: {
      type: String,
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
    },
    image: {
      type: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    
  },
  { timestamps: true }
);
// Ensure employeeID is unique within a company
employeeSchema.index({ employeeID: 1, companyId: 1 }, { unique: true });
export default mongoose.model('Employee', employeeSchema);
