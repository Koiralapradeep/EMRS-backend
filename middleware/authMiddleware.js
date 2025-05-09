import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Employee from '../models/Employee.js';

const verifyToken = (token) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
  }
  return jwt.verify(token, process.env.JWT_SECRET);
};

const verifyUser = async (req, res, next) => {
  try {
    console.log('DEBUG - Verifying user for request:', req.method, req.url);
    console.log('DEBUG - Incoming Headers:', req.headers);
    console.log('DEBUG - Cookies:', req.cookies);

    if (mongoose.connection.readyState !== 1) {
      console.error('AUTH ERROR: Database not connected. Current state:', mongoose.connection.readyState);
      return res.status(500).json({ success: false, error: 'Database not connected' });
    }

    let token;
    let tokenSource = 'none';
    if (req.headers.authorization) {
      const authParts = req.headers.authorization.split(' ');
      if (authParts.length === 2 && authParts[0] === 'Bearer') {
        token = authParts[1].trim();
        tokenSource = 'header';
      } else {
        console.error('AUTH ERROR: Malformed Authorization header:', req.headers.authorization);
        return res.status(401).json({ success: false, error: 'Invalid Authorization header format' });
      }
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt.trim();
      tokenSource = 'cookie';
    } else {
      console.error('AUTH ERROR: No token provided.');
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    console.log(`DEBUG - Token extracted from ${tokenSource} for ${req.method} ${req.url}`);
    console.log(`DEBUG - Token (truncated): ${token.slice(0, 10) + '...'}`);

    const tokenParts = token.split('.');
    if (tokenParts.length !== 3 || tokenParts.some((part) => !part)) {
      console.error(`AUTH ERROR: Token from ${tokenSource} does not have 3 valid parts:`, token);
      return res.status(401).json({ success: false, error: 'Invalid token format' });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
      console.log(`DEBUG - Decoded token (from ${tokenSource}):`, decoded);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        console.error('AUTH ERROR: Token expired:', err.message);
        return res.status(401).json({ success: false, error: 'Token expired' });
      } else {
        console.error('AUTH ERROR: Token verification failed:', err.message);
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }
    }

    if (!decoded?.id || !decoded?.role || !decoded?.email) {
      console.error(`AUTH ERROR: Missing required fields in token payload (from ${tokenSource}):`, decoded);
      return res.status(401).json({ success: false, error: 'Invalid token payload' });
    }

    console.log('DEBUG - Fetching user for ID:', decoded.id);
    const user = await User.findById(decoded.id).select('-password').populate('companyId', 'name');
    console.log('DEBUG - User query result:', user);
    if (!user) {
      console.error('AUTH ERROR: User not found for ID:', decoded.id);
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    console.log('DEBUG - Fetching employee for userId:', decoded.id);
    const employee = await Employee.findOne({ userId: decoded.id }).select('department').lean();
    console.log('DEBUG - Employee query result for userId:', decoded.id, 'Result:', employee);
    const departmentId = employee?.department ? employee.department.toString() : null;
    if (!employee) {
      console.warn(`No employee record found for userId: ${decoded.id}`);
    } else if (!employee.department) {
      console.warn(`Employee record found for userId: ${decoded.id}, but no department specified`);
    }

    req.user = {
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      companyId: user.companyId ? user.companyId._id.toString() : null,
      companyName: user.companyId ? user.companyId.name : 'No Company',
      departmentId: departmentId,
    };

    console.log(`DEBUG - User authenticated:`, req.user);
    next();
  } catch (error) {
    console.error('AUTH ERROR (unexpected):', error.message);
    return res.status(500).json({ success: false, error: 'Server error during authentication: ' + error.message });
  }
};

const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      console.error('Access denied: No role found for user');
      return res.status(403).json({ success: false, error: 'Access denied: No user role found' });
    }

    const userRole = req.user.role.toLowerCase();
    const normalizedAllowedRoles = allowedRoles.map((role) => role.toLowerCase());

    if (!normalizedAllowedRoles.includes(userRole)) {
      console.error(`Access denied for role: ${req.user.role}. Allowed roles: ${allowedRoles}`);
      return res.status(403).json({ success: false, error: `Access denied: Role ${req.user.role} not authorized` });
    }

    console.log(`DEBUG - Role authorized: ${req.user.role}, Allowed roles: ${allowedRoles}`);
    next();
  };
};

export { verifyUser, authorizeRoles };