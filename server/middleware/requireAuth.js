/**
 * middleware/requireAuth.js
 * Verifies the JWT from the HttpOnly cookie.
 * Attaches req.user = { id, username } on success.
 */

'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../db');

function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated — please log in.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Confirm user still exists in DB (handles deleted accounts)
    const user = db.findUserById(payload.id);
    if (!user) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Session invalid — please log in again.' });
    }
    req.user = { id: user.id, username: user.username };
    next();
  } catch (err) {
    res.clearCookie('token');
    return res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

module.exports = requireAuth;
