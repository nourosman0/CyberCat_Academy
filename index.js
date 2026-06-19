/**
 * index.js — CyberHub Express server
 *
 * Start: node index.js
 * Dev:   npx nodemon index.js
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const db         = require('./server/db');

const authRoutes     = require('./server/routes/auth');
const progressRoutes = require('./server/routes/progress');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ════════════════════════════════════════════════════════════════════════════
   SECURITY MIDDLEWARE
════════════════════════════════════════════════════════════════════════════ */

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc : ["'self'"],
      scriptSrc  : ["'self'", "'unsafe-inline'"],   // needed for inline JS in game pages
      scriptSrcAttr: ["'unsafe-inline'"],          // allow onclick handlers
      styleSrc   : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc    : ["'self'", 'https://fonts.gstatic.com'],
      imgSrc     : ["'self'", 'data:'],
      connectSrc : ["'self'"],
    },
  },
}));

// Global rate limiter — all routes
app.use(rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 200,
  message  : { error: 'Rate limit exceeded.' },
  standardHeaders: true,
  legacyHeaders  : false,
}));

app.use(cors({
  origin      : process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGIN || false  // set ALLOWED_ORIGIN=https://yourdomain.com in prod
    : 'http://localhost:' + PORT,
  credentials : true,  // required for cookies
}));

app.use(cookieParser());
app.use(express.json({ limit: '10kb' })); // prevent giant JSON payloads

/* ════════════════════════════════════════════════════════════════════════════
   GAME PAGE GATE MIDDLEWARE
   Intercepts requests for game2-5.html and checks server-side progress.
   game1.html is always accessible (level 1 is always unlocked).
════════════════════════════════════════════════════════════════════════════ */

async function gameGate(req, res, next) {
  // Extract level number from filename e.g. /game3.html → 3
  const match = req.path.match(/^\/game(\d)\.html$/);
  if (!match) return next();

  const lvl = parseInt(match[1], 10);
  if (lvl === 1) return next(); // level 1 always open

  // Verify JWT from cookie
  const token = req.cookies?.token;
  if (!token) {
    return res.redirect('/?error=login_required');
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.clearCookie('token');
    return res.redirect('/?error=session_expired');
  }

  // Check prerequisite level in DB
  const prereqMet = db.isPreviousLevelComplete(payload.id, lvl);
  if (!prereqMet) {
    return res.redirect(`/?error=level${lvl}_locked`);
  }

  next();
}

app.use(gameGate);

/* ════════════════════════════════════════════════════════════════════════════
   API ROUTES
════════════════════════════════════════════════════════════════════════════ */

app.use('/api', authRoutes);
app.use('/api', progressRoutes);

/* ─── Health check ───────────────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ════════════════════════════════════════════════════════════════════════════
   STATIC FILES  (hub.html, game pages, assets)
   Served AFTER the game gate middleware runs.
════════════════════════════════════════════════════════════════════════════ */

// Disable directory listings for security
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  next();
});

// Serve ONLY the public folder - explicitly block access to other files
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: 'hub.html',
  setHeaders: (res, filePath) => {
    // Prevent any file outside public/ from being served
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      res.status(403).send('Forbidden');
      return;
    }
  }
}));

// Fallback — serve hub for any unmatched route (SPA-style)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hub.html'));
});

/* ════════════════════════════════════════════════════════════════════════════
   START
════════════════════════════════════════════════════════════════════════════ */

async function start() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`\n🐱 CyberHub server running → http://localhost:${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Database    : ./data/cyberhub.db\n`);
    });
  } catch (err) {
    console.error('[start] Fatal error:', err);
    process.exit(1);
  }
}

start();
