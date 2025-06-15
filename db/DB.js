import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    console.log('DEBUG - MONGO_URI in DB.js:', process.env.MONGO_URI);
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is undefined in DB.js');
    }
    await mongoose.connect(process.env.MONGO_URI, {
      ssl: true, // Required for MongoDB Atlas
    });
    console.log('Connected to MongoDB Atlas');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    if (err.name === 'MongoNetworkError' && err.code === 'ENOTFOUND') {
      console.error('DNS resolution failed. Check your network or MONGO_URI hostname.');
    }
    process.exit(1);
  }
};

export default connectDB;