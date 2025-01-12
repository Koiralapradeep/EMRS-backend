// @ts-nocheck
import express from 'express';
import { login, register, verify } from '../controller/authController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Login route
router.post('/login', login);

// Register route
router.post('/register', register);

// Verify route
router.post('/verify', authMiddleware, verify);

export default router;
