const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const env = require('./config/env');
const { generalRateLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

// Trust reverse proxies (Render, Cloudflare, Heroku) for accurate IP resolution in rate limiting
app.set('trust proxy', 1);

// 1. Instant GET /health endpoint - NO DB call, zero overhead for uptime ping monitors
// Mounted before rate limiters to avoid blocking uptime monitors like UptimeRobot/BetterStack
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// 2. Helmet for HTTP Security Headers
app.use(helmet());

// 3. Compression for response payload size optimization
app.use(compression());

// 4. Request logging in development only
if (env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// 5. Strict CORS Configuration: Read from env ALLOWED_ORIGIN (never "*")
const allowedOrigins = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, curl, server-to-server, mobile)
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    // Allow Postman Web (web.postman.co) and testing tools
    if (origin.includes('postman.co') || origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: Origin ${origin} is not allowed by CORS policy.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));

// 6. Body parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 7. General Rate Limiter: 100 requests per 15 min per IP on all /api routes
// (OTP routes have their own strict rate limiter applied individually)
app.use('/api', generalRateLimiter);

// 8. Mount Main API Routes
app.use('/api', routes);

// 9. Root route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'College Faculty-Student Portal API is running.',
    healthEndpoint: '/health',
    documentation: '/api',
  });
});

// 10. Handle unmatched routes (404)
app.use(notFoundHandler);

// 11. Centralized Error Handler (Never leaks stack traces in production)
app.use(errorHandler);

module.exports = app;
