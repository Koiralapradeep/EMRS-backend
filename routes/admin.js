import express from 'express';
import Company from '../models/Company.js';
import User from '../models/User.js';
const router = express.Router();

/**
 * @route   GET /api/admin/stats
 * @desc    Fetch statistics for admin dashboard
 * @access  Admin
 * @returns {Object} Statistics including total companies, total managers, and total users
 */
router.get('/stats', async (req, res) => {
  try {
    // Fetch all stats in parallel for efficiency
    const [totalCompanies, totalManagers, totalUsers] = await Promise.all([
      Company.countDocuments(),
      Company.countDocuments({ manager: { $ne: null } }), // Count companies with a manager assigned
      User.countDocuments(),
    ]);

    // Send response with stats
    res.status(200).json({
      totalCompanies,
      totalManagers,
      totalUsers,
    });
  } catch (error) {
    // Log error for debugging with additional context
    console.error('Error fetching admin stats:', error);
    // Return standardized error response
    res.status(500).json({ message: 'Failed to fetch statistics', error: error.message });
  }
});

export default router;