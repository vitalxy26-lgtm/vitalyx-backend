require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

// ── Startup guards ──────────────────────────────────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'MONGODB_URI'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: ${key} is not set in environment variables.`);
    process.exit(1);
  }
}

const aiRoutes = require('./src/routes/ai.routes');
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const paymentRoutes = require('./src/routes/payment.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Security middleware ─────────────────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: [
    // Add your production domain here when deploying:
    // 'https://your-app-domain.com',
    /^http:\/\/localhost(:\d+)?$/,   // local dev
    /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,  // LAN dev (Expo)
    /^exp:\/\//,                     // Expo Go
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// ── Body parsing — 1 MB default, 50 MB only for food-scan uploads ───────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Routes
app.use('/api/ai/scanfood', express.json({ limit: '50mb' }));  // large payloads only here
app.use('/api/ai', aiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/payment', paymentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Vitalyx Backend is running' });
});

// ── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: 'Something went wrong' });
});

// ── Database Connection ─────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
})
  .then(() => {
    console.log('MongoDB connected successfully');
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('FATAL: MongoDB connection error:', err);
    process.exit(1);
  });
