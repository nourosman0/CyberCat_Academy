/**
 * routes/auth.js
 * POST /api/register  — create account
 * POST /api/login     — returns HttpOnly JWT cookie
 * POST /api/logout    — clears cookie
 * GET  /api/me        — returns current user info (no password)
 */

'use strict';

const express     = require('express');
const bcrypt      = require('bcrypt');
const jwt         = require('jsonwebtoken');
const rateLimit   = require('express-rate-limit');
const db          = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const SALT_ROUNDS = 12;
const COOKIE_OPTS = {
  httpOnly : true,   // JS cannot read this cookie — blocks XSS token theft
  secure   : process.env.NODE_ENV === 'production', // HTTPS only in prod
  sameSite : 'strict',
  maxAge   : 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

/* ─── Rate limiters ──────────────────────────────────────────────────────── */
const authLimiter = rateLimit({
  windowMs : 15 * 60 * 1000, // 15 minutes
  max      : 10,              // max 10 attempts per window per IP
  message  : { error: 'Too many attempts — try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function issueToken(res, user) {
  const token = jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('token', token, COOKIE_OPTS);
}

function validateUsername(u) {
  // 3–24 chars, letters/numbers/underscores/hyphens only
  return /^[a-zA-Z0-9_-]{3,24}$/.test(u);
}

function validatePassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 128;
}

function validateEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ─── POST /api/register ─────────────────────────────────────────────────── */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Username: 3–24 chars, letters/numbers/_/- only.' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be 6–128 characters.' });
    }
    if (db.findUserByUsername(username)) {
      return res.status(409).json({ error: 'Codename already taken.' });
    }
    if (db.findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = db.createUser(username, email, hashedPassword);

    issueToken(res, user);
    return res.status(201).json({
      message : 'Agent created.',
      user    : { id: user.id, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error('[register]', err);
    return res.status(500).json({ error: 'Server error — please try again.' });
  }
});

/* ─── POST /api/login ────────────────────────────────────────────────────── */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const user = db.findUserByUsername(username);

    // Always run bcrypt.compare even on miss — prevents username enumeration
    // via timing differences.
    const passwordMatch = user
      ? await bcrypt.compare(password, user.password)
      : await bcrypt.compare(password, '$2b$12$invalidhashpadding000000000000000000000000000000000000');

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    issueToken(res, user);
    return res.json({
      message : 'Logged in.',
      user    : { id: user.id, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Server error — please try again.' });
  }
});

/* ─── POST /api/logout ───────────────────────────────────────────────────── */
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTS);
  return res.json({ message: 'Logged out.' });
});

/* ─── GET /api/me ────────────────────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  const user = db.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: { id: user.id, username: user.username, email: user.email } });
});

module.exports = router;
