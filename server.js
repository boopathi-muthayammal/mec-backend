require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const fs = require('fs');

const { initDatabase } = require('./database');

const app = express();
const PORT = 3000;

// Trust first proxy (needed for secure cookies behind reverse proxies like Render/Vercel)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Custom CORS middleware to support credentialed cross-origin requests from Vercel frontend
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://mec-frontend.vercel.app',
    'https://mec-frontend-.vercel.app',
    'http://localhost:5173'
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const isProd = process.env.NODE_ENV === 'production';

app.use(session({
  secret: 'exam-portal-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd
  }
}));

// Serve static files from 'public' directory and fallback to 'frontend/dist' (local dev setup)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// Start server after database is initialized
async function start() {
  await initDatabase();
  console.log('Database initialized successfully');

  // Mount API routes
  const authRoutes = require('./routes/auth');
  const adminRoutes = require('./routes/admin');
  const studentRoutes = require('./routes/student');

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/student', studentRoutes);

  // Helper to get active SPA entry path
  const getIndexHtmlPath = () => {
    const frontendDist = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    if (fs.existsSync(frontendDist)) {
      return frontendDist;
    }
    return path.join(__dirname, 'public', 'index.html');
  };

  // Root route serves index.html
  app.get('/', (req, res) => {
    res.sendFile(getIndexHtmlPath());
  });

  // Catch-all: serve index.html for any unmatched routes (SPA support)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(getIndexHtmlPath());
    } else {
      res.status(404).json({ success: false, message: 'API endpoint not found' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
