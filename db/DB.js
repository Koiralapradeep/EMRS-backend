import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    console.log('DEBUG - MONGO_URI in DB.js:', process.env.MONGO_URI);
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is undefined in DB.js');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected: localhost');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
};

export default connectDB;