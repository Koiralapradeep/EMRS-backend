import express from "express";

const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    return res.json({
      success: true,
      summary: [
        { title: "Total Employees", value: 100, icon: "faUsers", bgColor: "bg-blue-500" },
        { title: "Departments", value: 5, icon: "faBuilding", bgColor: "bg-green-500" },
      ],
      leaveDetails: [
        { title: "Pending Leave", value: 12, icon: "faClock", bgColor: "bg-yellow-500" },
        { title: "Approved Leave", value: 8, icon: "faCheck", bgColor: "bg-green-500" },
      ],
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
