# CyberHub — Secure Backend

A Node.js/Express backend for the CyberHub cyber awareness training platform.
Replaces all client-side localStorage auth and flag-checking with server-side validation.

## Security improvements over the original

| Before | After |
|---|---|
| Flags hardcoded in JavaScript | Flags in server-only `.env`, never sent to browser |
| `btoa(password)` in localStorage | `bcrypt` hashed passwords in SQLite |
| `localStorage` session | Signed JWT in `HttpOnly; SameSite=Strict` cookie |
| Progress in localStorage (trivially spoofed) | Progress in server DB, enforced server-side |
| Any URL accessible directly | Game pages gated by server middleware |
| No rate limiting | Rate limiting on login, register, and flag endpoints |
| No security headers | `helmet` sets CSP, X-Frame-Options, etc. |

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Paste the output as your `JWT_SECRET` value. Change flags if desired.

### 3. Add your game files

Place your HTML game files in the `public/` folder:

```
public/
  hub.html       ← already updated (API-driven)
  game1.html
  game2.html
  game3.html
  game4.html
  game5.html
```

### 4. Run the server

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev      # requires: npm install -g nodemon
```

Visit `http://localhost:3000`

---

## API Reference

All endpoints return JSON. Authentication uses an `HttpOnly` cookie set automatically.

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/register` | `{username, email, password}` | Create account, sets cookie |
| POST | `/api/login` | `{username, password}` | Login, sets cookie |
| POST | `/api/logout` | — | Clears cookie |
| GET | `/api/me` | — | Returns current user (no password) |

### Progress & Flags

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/progress` | — | `{level1: bool, level2: bool, ...}` |
| POST | `/api/verify-flag` | `{level: 1-5, flag: "CTF{...}"}` | Server-side flag check |
| GET | `/api/game/:level` | — | Returns `{unlocked: true}` or 403 |

---

## Deployment (Railway / Render / Fly.io)

1. Push code to GitHub (**make sure `.env` and `data/` are in `.gitignore`**)
2. Create a new project on Railway/Render
3. Set environment variables in their dashboard:
   - `JWT_SECRET` — your generated secret
   - `FLAG_1` through `FLAG_5` — your CTF flags
   - `NODE_ENV=production`
   - `ALLOWED_ORIGIN=https://yourdomain.com`
4. Set start command: `node index.js`
5. Deploy

For persistent storage on Railway/Render, mount a volume at `/app/data` so the
SQLite database survives redeploys. Alternatively, migrate to PostgreSQL using
the `pg` package — the query structure in `db.js` is intentionally simple to
make this easy.

---

## Project structure

```
cyberhub/
├── index.js                  ← Express app + server entry point
├── .env.example              ← Copy to .env, never commit .env
├── .gitignore
├── package.json
├── data/                     ← SQLite database (auto-created, gitignored)
│   └── cyberhub.db
├── server/
│   ├── db.js                 ← Database layer (sql.js / SQLite)
│   ├── middleware/
│   │   └── requireAuth.js    ← JWT cookie verification
│   └── routes/
│       ├── auth.js           ← register / login / logout / me
│       └── progress.js       ← progress / verify-flag / game gate
└── public/                   ← Static files served by Express
    ├── hub.html              ← Updated: all localStorage removed
    ├── game1.html
    └── ...
```
