import Department from "../models/Department";

export const addDepartment = async (req, res) => {
  try {
    const { departmentName, departmentCode, description } = req.body;
    const companyId = req.user.companyId || req.body.companyId; // Get companyId from token or request body

    if (!companyId) {
      return res.status(400).json({ success: false, error: "Company ID is required." });
    }

    const department = new Department({
      departmentName,
      departmentCode,
      description,
      companyId, // Attach companyId
    });

    await department.save();
    res.status(201).json({ success: true, message: "Department added successfully", department });
  } catch (error) {
    console.error("Error adding department:", error.message);
    res.status(500).json({ success: false, error: "Server error while adding department" });
  }
};
