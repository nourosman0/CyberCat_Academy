/**
 * routes/progress.js
 * GET  /api/progress        — returns { level1: bool, level2: bool, ... }
 * POST /api/verify-flag     — { level, flag } → { correct: bool }
 * GET  /api/game/:level     — gate: serves game page only if prereq is met
 */

'use strict';

const express     = require('express');
const crypto      = require('crypto');
const rateLimit   = require('express-rate-limit');
const db          = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

/* ─── Rate limiter for flag submission ───────────────────────────────────── */
const flagLimiter = rateLimit({
  windowMs : 5 * 60 * 1000, // 5 minutes
  max      : 20,             // max 20 flag attempts per window per IP
  message  : { error: 'Too many flag attempts — slow down, hacker.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

/* ─── Timing-safe string comparison ─────────────────────────────────────── */
function safeEqual(a, b) {
  // Both must be same length for timingSafeEqual; pad to prevent length leakage
  const bufA = Buffer.from(String(a).padEnd(128));
  const bufB = Buffer.from(String(b).padEnd(128));
  return crypto.timingSafeEqual(bufA, bufB) && a.length === b.length;
}

/* ─── GET /api/progress ──────────────────────────────────────────────────── */
router.get('/progress', requireAuth, (req, res) => {
  try {
    const progress = db.getProgress(req.user.id);
    return res.json({ progress });
  } catch (err) {
    console.error('[progress GET]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/* ─── POST /api/verify-flag ──────────────────────────────────────────────── */
router.post('/verify-flag', requireAuth, flagLimiter, (req, res) => {
  try {
    const { level, flag } = req.body;

    // Validate level
    const lvl = parseInt(level, 10);
    if (!lvl || lvl < 1 || lvl > 5) {
      return res.status(400).json({ error: 'Invalid level.' });
    }

    // Enforce sequential unlock — can't submit level 3 flag without finishing level 2
    if (!db.isPreviousLevelComplete(req.user.id, lvl)) {
      return res.status(403).json({ error: `Complete level ${lvl - 1} first.` });
    }

    // Get flag from env — never from client
    const correctFlag = process.env[`FLAG_${lvl}`];
    if (!correctFlag) {
      console.error(`[verify-flag] FLAG_${lvl} not set in environment`);
      return res.status(500).json({ error: 'Server configuration error.' });
    }

    const correct = safeEqual(
      (flag || '').trim().toUpperCase(),
      correctFlag.trim().toUpperCase()
    );

    if (correct) {
      db.markLevelComplete(req.user.id, lvl);
      return res.json({
        correct : true,
        message : `Level ${lvl} complete! Well done, ${req.user.username}.`,
      });
    }

    // Wrong flag — don't hint at anything useful
    return res.json({ correct: false, message: 'Incorrect flag — keep trying.' });

  } catch (err) {
    console.error('[verify-flag]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/* ─── GET /api/game/:level — server-side page gate ───────────────────────── */
router.get('/game/:level', requireAuth, (req, res) => {
  try {
    const lvl = parseInt(req.params.level, 10);
    if (!lvl || lvl < 1 || lvl > 5) {
      return res.status(404).json({ error: 'Unknown level.' });
    }

    if (!db.isPreviousLevelComplete(req.user.id, lvl)) {
      return res.status(403).json({
        error    : `Level ${lvl} is locked.`,
        required : lvl - 1,
      });
    }

    // Authorised — the actual HTML file is served here by Express static
    // middleware. This endpoint is used for API-style checks; static files
    // are gated separately in index.js via the gameGate middleware.
    return res.json({ unlocked: true });
  } catch (err) {
    console.error('[game gate]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/* ─── GET /api/flag/:level — deliver flag for completed level ──────────────── */
router.get('/flag/:level', requireAuth, (req, res) => {
  try {
    const lvl = parseInt(req.params.level, 10);
    if (!lvl || lvl < 1 || lvl > 5) {
      return res.status(404).json({ error: 'Unknown level.' });
    }

    // Only deliver the flag if the user has unlocked this level
    if (!db.isPreviousLevelComplete(req.user.id, lvl)) {
      return res.status(403).json({ error: 'Level locked.' });
    }

    const flag = process.env[`FLAG_${lvl}`];
    if (!flag) {
      console.error(`[flag endpoint] FLAG_${lvl} not set in environment`);
      return res.status(500).json({ error: 'Server configuration error.' });
    }

    return res.json({ flag });
  } catch (err) {
    console.error('[flag endpoint]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
