import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    accomplishments: { type: String, required: true },
    challenges: { type: String, required: true },
    suggestions: { type: String, required: true },
<<<<<<< HEAD
=======
    makePrivate: { type: Boolean, default: false },     // Combined from features/Feedback
    saveToDashboard: { type: Boolean, default: false }, // Combined from features/Feedback
>>>>>>> development
  },
  { timestamps: true }
);

<<<<<<< HEAD
const Feedback = mongoose.model("Feedback", feedbackSchema);
export default Feedback;
=======
export default mongoose.model("Feedback", feedbackSchema);
>>>>>>> development
