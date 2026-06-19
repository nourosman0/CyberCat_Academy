# CyberHub Security Architecture

## Overview

CyberHub is a Node.js/Express backend for a cyber awareness training platform. It replaces all client-side authentication and flag-checking with server-side validation, addressing critical security vulnerabilities in the original client-side implementation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │   hub.html  │  │  game1-5.html │  │     API Calls      │   │
│  │             │  │              │  │  (fetch with       │   │
│  │  UI State   │  │ Game Logic   │  │   credentials)     │   │
│  └─────────────┘  └──────────────┘  └─────────┬──────────┘   │
└────────────────────────────────────────────────┼────────────────┘
                                                   │
                                                   │ HTTP/JSON
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Express Server                              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  SECURITY MIDDLEWARE                                         │  │
│  │  • helmet (CSP, XSS protection)                              │  │
│  │  • express-rate-limit (global: 200/15min)                    │  │
│  │  • cors (credentials: true)                                  │  │
│  │  • cookie-parser (HttpOnly JWT cookie)                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ROUTES                                                      │  │
│  │  • /api/auth/*  → register, login, logout, me                │  │
│  │  • /api/progress → progress, verify-flag, game gate           │  │
│  │  • /api/flag/:level → deliver flag (auth + unlock check)    │  │
│  │  • /api/health → health check                               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  MIDDLEWARE                                                  │  │
│  │  • gameGate → blocks game2-5.html until level 1 complete    │  │
│  │  • requireAuth → verifies JWT cookie, attaches req.user     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  DATABASE (SQLite via sql.js)                              │  │
│  │  • users: id, username, email, password (bcrypt hash)      │  │
│  │  • progress: user_id, level, completed, completed_at       │  │
│  │  • auto-seeded progress rows per user via trigger            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ENVIRONMENT VARIABLES                                     │  │
│  │  • JWT_SECRET → signs/verify JWT tokens                    │  │
│  │  • FLAG_1..5 → CTF flags (never sent to client)            │  │
│  │  • NODE_ENV → development/production                       │  │
│  │  • ALLOWED_ORIGIN → CORS origin in production              │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Authentication Flow

### 1. Registration
```
POST /api/register
Body: { username, email, password }
↓
1. Validate input (username: 3-24 chars, email format, password: 6-128 chars)
2. Check for duplicate username/email
3. Hash password with bcrypt (12 salt rounds)
4. Insert user → auto-creates progress rows via trigger
5. Generate JWT (7-day expiry)
6. Set HttpOnly cookie → return user (no password)
```

### 2. Login
```
POST /api/login
Body: { username, password }
↓
1. Find user by username
2. bcrypt.compare(password, stored_hash) ← timing-safe
3. Generate JWT
4. Set HttpOnly cookie → return user
```

### 3. Session Verification
```
GET /api/me
↓
1. Read JWT from HttpOnly cookie
2. Verify signature with JWT_SECRET
3. Check user still exists in DB
4. Return user object (no password)
```

### 4. Logout
```
POST /api/logout
↓
Clear HttpOnly cookie
```

## Game Completion Flow

### Level Win Sequence
```
Game Logic → Player Wins
        ↓
1. Fetch flag from /api/flag/:level (cookie auth)
2. Display flag in win overlay
3. Submit flag to /api/verify-flag (cookie auth)
   → Server validates:
     • User authenticated
     • Previous level completed
     • Flag matches (timing-safe comparison)
   → On success: mark level complete in DB
4. Show win screen with flag
```

### Flag Security
- Flags stored only in `.env` (never in client code)
- `/api/flag/:level` only returns flag if:
  - User is authenticated (valid JWT cookie)
  - User has unlocked the level (previous level complete)
- Flags are displayed once per win, then "Loading..." until fetched

## Access Control

### Game Page Gate (`gameGate` middleware)
```
Request for /gameN.html
        ↓
1. Extract level number from path
2. If level === 1: allow
3. Verify JWT cookie
4. Check DB: isPreviousLevelComplete(userId, level)
5. If not complete: redirect to /?error=levelN_locked
```

### Progress API
```
GET /api/progress
        ↓
Return: { level1: bool, level2: bool, ... }

POST /api/verify-flag
Body: { level, flag }
        ↓
1. Check authentication
2. Check prerequisites
3. Timing-safe flag comparison
4. Mark level complete in DB
```

## Database Schema

```sql
-- Users table
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT UNIQUE NOT NULL COLLATE NOCASE,
  email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Progress table
CREATE TABLE progress (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level        INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, level)
);

-- Trigger: auto-create progress rows for new users
CREATE TRIGGER seed_progress
AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO progress (user_id, level) VALUES
    (NEW.id, 1),(NEW.id, 2),(NEW.id, 3),(NEW.id, 4),(NEW.id, 5);
END;
```

## Security Headers (helmet)

```javascript
{
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],     // for game pages
  scriptSrcAttr: ["'unsafe-inline'"],           // for onclick handlers
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  // ... additional headers
}
```

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| /api/register | 10 req | 15 min |
| /api/login | 10 req | 15 min |
| /api/verify-flag | 20 req | 5 min |
| Global | 200 req | 15 min |

## Deployment

### Environment Variables
```
PORT=3000
NODE_ENV=production
JWT_SECRET=<64-char-random-string>
FLAG_1=CTF{...}
FLAG_2=CTF{...}
FLAG_3=CTF{...}
FLAG_4=CTF{...}
FLAG_5=CTF{...}
ALLOWED_ORIGIN=https://yourdomain.com
```

### Start Command
```bash
npm start  # node index.js
```

### Production Checklist
- [ ] Set strong `JWT_SECRET`
- [ ] Set `NODE_ENV=production`
- [ ] Set `ALLOWED_ORIGIN`
- [ ] Mount persistent volume at `/app/data` (Railway/Render)
- [ ] Enable HTTPS (set `secure: true` in cookie options)
- [ ] Configure firewall rules

## API Reference

### Auth Endpoints
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | /api/register | {username, email, password} | Create account, set cookie |
| POST | /api/login | {username, password} | Login, set cookie |
| POST | /api/logout | - | Clear cookie |
| GET | /api/me | - | Return current user |

### Progress Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/progress | {level1: bool, level2: bool, ...} |
| POST | /api/verify-flag | {level, flag} → {correct: bool} |
| GET | /api/game/:level | {unlocked: true} or 403 |
| GET | /api/flag/:level | {flag: "CTF{...}"} if unlocked |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | {status: "ok", timestamp: ISO} |