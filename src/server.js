const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');

let server;

const startServer = async () => {
  try {
    console.log(`[Server] Starting Faculty-Student Portal API in "${env.NODE_ENV}" mode...`);

    // 1. Bind port immediately so hosting platforms (Render, Heroku) detect open port without timing out
    server = app.listen(env.PORT, () => {
      console.log(`[Server] Listening on port ${env.PORT}`);
      console.log(`[Server] Health check available at: /health`);
      console.log(`[Server] Allowed CORS Origin: "${env.ALLOWED_ORIGIN}"`);
      if (env.ALLOWED_EMAIL_DOMAIN) {
        console.log(`[Server] Restricted Email Domain: "@${env.ALLOWED_EMAIL_DOMAIN}"`);
      }
    });

    // 2. Connect to MongoDB Atlas
    if (!env.MONGODB_URI || env.MONGODB_URI.includes('127.0.0.1') || env.MONGODB_URI.includes('localhost')) {
      if (env.NODE_ENV === 'production') {
        console.warn('\n⚠️ [Database Warning] MONGODB_URI is pointing to localhost or not set in Render Environment Variables!');
        console.warn('⚠️ Render cannot connect to 127.0.0.1. Please set MONGODB_URI to your MongoDB Atlas cloud URI in Render dashboard.\n');
      }
    }

    await connectDB();
  } catch (error) {
    console.error('[Server] Database startup error:', error.message);
  }
};

// Graceful shutdown handling for Render deployments
const gracefulShutdown = (signal) => {
  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);
  if (server) {
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      try {
        await mongoose.connection.close(false);
        console.log('[Database] MongoDB connection closed gracefully.');
        process.exit(0);
      } catch (err) {
        console.error('[Database] Error closing MongoDB connection:', err.message);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
