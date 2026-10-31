const mongoose = require('mongoose');
const env = require('./env');

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 3000;

let isConnected = false;

const connectDB = async (retryCount = 0) => {
  const options = {
    maxPoolSize: 10, // Strictly capped for MongoDB Atlas Free Tier (M0) connection limits
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  };

  try {
    const conn = await mongoose.connect(env.MONGODB_URI, options);
    isConnected = true;
    console.log(`[Database] MongoDB Connected successfully to host: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    isConnected = false;
    console.error(`[Database] Connection failure attempt ${retryCount + 1}/${MAX_RETRIES}: ${error.message}`);
    
    if (retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`[Database] Retrying connection in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return connectDB(retryCount + 1);
    } else {
      console.error('[Database] Maximum MongoDB connection retries exceeded. Exiting process.');
      throw error;
    }
  }
};

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('[Database] MongoDB connection lost. Reconnecting...');
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  console.log('[Database] MongoDB reconnected successfully.');
});

mongoose.connection.on('error', (err) => {
  console.error('[Database] MongoDB runtime error:', err.message);
});

module.exports = {
  connectDB,
  isDbConnected: () => isConnected,
};
