// @ts-nocheck
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const verifyUser = async (req, res, next) => {
  try {
    // Extract the token from the Authorization header
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      console.warn('No token provided');
      return res.status(401).json({ success: false, error: 'Token not provided' }); // Use 401 for unauthorized
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_KEY);
    console.log('Decoded Token:', decoded);

    // Find the user in the database
    const user = await User.findById(decoded._id).select('-password');
    if (!user) {
      console.warn('User not found');
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Attach the user to the request object for access in subsequent middleware/routes
    req.user = user;

    // Proceed to the next middleware/route
    next();
  } catch (error) {
    console.error('Token validation error:', error.message);

    // Handle JWT-specific errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired' });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Generic server error
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

export default verifyUser;
