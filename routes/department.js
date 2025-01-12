import express from 'express';
import Department from '../models/Department.js';

const router = express.Router();

// Fetch all departments
router.get('/', async (req, res) => {
  try {
    const departments = await Department.find();
    res.status(200).json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error.message);
    res.status(500).json({ error: 'Failed to fetch departments.' });
  }
});

// Fetch a single department by ID
router.get('/:id', async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ error: 'Department not found.' });
    }
    res.status(200).json(department);
  } catch (error) {
    console.error('Error fetching department:', error.message);
    res.status(500).json({ error: 'Failed to fetch department.' });
  }
});

// Add a new department
router.post('/', async (req, res) => {
  const { departmentName, departmentCode, description } = req.body;

  if (!departmentName || !departmentCode) {
    return res.status(400).json({ error: 'Department name and code are required.' });
  }

  try {
    const existingDepartment = await Department.findOne({ departmentCode });
    if (existingDepartment) {
      return res.status(400).json({ error: 'Department code already exists.' });
    }

    const newDepartment = new Department({ departmentName, departmentCode, description });
    await newDepartment.save();
    res.status(201).json(newDepartment);
  } catch (error) {
    console.error('Error adding department:', error.message);
    res.status(500).json({ error: 'Failed to add department.' });
  }
});

// Update a department by ID
router.put('/:id', async (req, res) => {
  const { departmentName, departmentCode, description } = req.body;

  if (!departmentName || !departmentCode) {
    return res.status(400).json({ error: 'Department name and code are required.' });
  }

  try {
    const updatedDepartment = await Department.findByIdAndUpdate(
      req.params.id,
      { departmentName, departmentCode, description },
      { new: true } // Return the updated document
    );

    if (!updatedDepartment) {
      return res.status(404).json({ error: 'Department not found.' });
    }

    res.status(200).json(updatedDepartment);
  } catch (error) {
    console.error('Error updating department:', error.message);
    res.status(500).json({ error: 'Failed to update department.' });
  }
});

// Delete a department by ID
router.delete('/:id', async (req, res) => {
  try {
    const deletedDepartment = await Department.findByIdAndDelete(req.params.id);
    if (!deletedDepartment) {
      return res.status(404).json({ error: 'Department not found.' });
    }
    res.status(200).json({ message: 'Department deleted successfully.' });
  } catch (error) {
    console.error('Error deleting department:', error.message);
    res.status(500).json({ error: 'Failed to delete department.' });
  }
});

export default router;
