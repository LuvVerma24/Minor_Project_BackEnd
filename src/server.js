const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');

let server;

const startServer = async () => {
  try {
    console.log(`[Server] Starting Faculty-Student Portal API in "${env.NODE_ENV}" mode...`);

    // Connect to MongoDB Atlas (with maxPoolSize: 10 and startup retry)
    await connectDB();

    server = app.listen(env.PORT, () => {
      console.log(`[Server] Listening on http://localhost:${env.PORT}`);
      console.log(`[Server] Health check available at: http://localhost:${env.PORT}/health`);
      console.log(`[Server] Allowed CORS Origin: "${env.ALLOWED_ORIGIN}"`);
      if (env.ALLOWED_EMAIL_DOMAIN) {
        console.log(`[Server] Restricted Email Domain: "@${env.ALLOWED_EMAIL_DOMAIN}"`);
      }
    });
  } catch (error) {
    console.error('[Server] Fatal startup error:', error.message);
    process.exit(1);
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
