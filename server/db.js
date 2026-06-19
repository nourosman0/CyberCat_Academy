/**
 * db.js — Database layer using sql.js (pure-JS SQLite, no native build needed)
 * Persists data to disk via fs read/write around every mutating operation.
 */

'use strict';

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'cyberhub.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db = null;

/* ─── Initialise ─────────────────────────────────────────────────────────── */
async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  _db.run(`PRAGMA journal_mode = WAL;`);
  _db.run(`PRAGMA foreign_keys = ON;`);

  createSchema();
  persist();

  console.log('[DB] Initialised at', DB_PATH);
}

/* ─── Schema ─────────────────────────────────────────────────────────────── */
function createSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      email       TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      password    TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS progress (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      level        INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
      completed    INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      PRIMARY KEY (user_id, level)
    );
  `);

  // Seed progress rows for every user/level combination so GET is always a
  // simple lookup rather than an upsert path with missing rows.
  _db.run(`
    CREATE TRIGGER IF NOT EXISTS seed_progress
    AFTER INSERT ON users
    BEGIN
      INSERT OR IGNORE INTO progress (user_id, level) VALUES
        (NEW.id, 1),(NEW.id, 2),(NEW.id, 3),(NEW.id, 4),(NEW.id, 5);
    END;
  `);
}

/* ─── Persist to disk ────────────────────────────────────────────────────── */
function persist() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/* ─── Helper: run a statement and auto-persist ───────────────────────────── */
function run(sql, params = []) {
  _db.run(sql, params);
  persist();
}

/* ─── Helper: return all rows as plain objects ───────────────────────────── */
function all(sql, params = []) {
  const stmt    = _db.prepare(sql);
  const results = [];
  stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

/* ─── Helper: return single row or null ─────────────────────────────────── */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

/* ════════════════════════════════════════════════════════════════════════════
   USER QUERIES
════════════════════════════════════════════════════════════════════════════ */

function createUser(username, email, hashedPassword) {
  run(
    `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
    [username, email, hashedPassword]
  );
  return get(`SELECT id, username, email, created_at FROM users WHERE username = ?`, [username]);
}

function findUserByUsername(username) {
  return get(`SELECT * FROM users WHERE username = ?`, [username]);
}

function findUserByEmail(email) {
  return get(`SELECT * FROM users WHERE email = ?`, [email]);
}

function findUserById(id) {
  return get(`SELECT id, username, email, created_at FROM users WHERE id = ?`, [id]);
}

/* ════════════════════════════════════════════════════════════════════════════
   PROGRESS QUERIES
════════════════════════════════════════════════════════════════════════════ */

function getProgress(userId) {
  const rows = all(
    `SELECT level, completed, completed_at FROM progress WHERE user_id = ? ORDER BY level`,
    [userId]
  );
  // Return as { level1: bool, level2: bool, ... }
  const result = {};
  for (const row of rows) {
    result[`level${row.level}`] = row.completed === 1;
    if (row.completed_at) result[`level${row.level}_at`] = row.completed_at;
  }
  return result;
}

function markLevelComplete(userId, level) {
  run(
    `UPDATE progress
     SET completed = 1, completed_at = datetime('now')
     WHERE user_id = ? AND level = ?`,
    [userId, level]
  );
}

function isLevelComplete(userId, level) {
  const row = get(
    `SELECT completed FROM progress WHERE user_id = ? AND level = ?`,
    [userId, level]
  );
  return row ? row.completed === 1 : false;
}

function isPreviousLevelComplete(userId, level) {
  if (level === 1) return true; // Level 1 is always accessible
  return isLevelComplete(userId, level - 1);
}

module.exports = {
  init,
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  getProgress,
  markLevelComplete,
  isLevelComplete,
  isPreviousLevelComplete,
};
