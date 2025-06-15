import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    console.log('DEBUG - MONGO_URI in DB.js:', process.env.MONGO_URI);
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is undefined in DB.js');
    }
    await mongoose.connect(process.env.MONGO_URI, {
      ssl: true, // Required for MongoDB Atlas
      retryWrites: true,
      w: 'majority',
      maxPoolSize: 10, // Optimize for serverless
      minPoolSize: 2,
    });
    console.log('Connected to MongoDB Atlas');
    return mongoose.connection; // Optional: return for reuse
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    if (err.name === 'MongoNetworkError' && err.code === 'ENOTFOUND') {
      console.error('DNS resolution failed. Check your network or MONGO_URI hostname.');
    }
    throw err; // Propagate error to be caught by Express
  }
};

export default connectDB;