import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    accomplishments: { type: String, required: true },
    challenges: { type: String, required: true },
    suggestions: { type: String, required: true },

    makePrivate: { type: Boolean, default: false },       // New field: if true, employee info is hidden in Manager view
    saveToDashboard: { type: Boolean, default: false },     // New field: if true, feedback is permanently saved on Employee Dashboard
  },
  { timestamps: true }
);

const Feedback = mongoose.model("Feedback", feedbackSchema);
export default Feedback;
