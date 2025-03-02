import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true }, 
    accomplishments: { type: String, required: true },
    challenges: { type: String, required: true },
    suggestions: { type: String, required: true },

    makePrivate: { type: Boolean, default: false },
    saveToDashboard: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Feedback = mongoose.model("Feedback", feedbackSchema);
export default Feedback;
