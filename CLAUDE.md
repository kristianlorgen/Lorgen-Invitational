# CLAUDE.md — Lorgen Invitational

This file defines conventions for working on the Lorgen Invitational golf tournament website.
Read this before making any changes to the codebase.

---

## Project Overview

Annual 2-man scramble golf tournament website.
**Stack:** Node.js · Express · SQLite (better-sqlite3) · Vanilla HTML/CSS/JS · Server-Sent Events

---

## Design System

### Brand Colors — always use CSS variables, never raw hex in HTML/JS

| Variable | Hex | Use |
|---|---|---|
| `--gold` | `#C9A84C` | Primary accent — buttons, icons, highlights |
| `--gold-light` | `#E8C87A` | Hover states, headings on dark bg |
| `--gold-dark` | `#9A7B2E` | Text on light bg, secondary buttons |
| `--gold-pale` | `#FAF4E3` | Card backgrounds, tag backgrounds |
| `--gold-border` | `#E5D9A9` | Borders, dividers |
| `--dark` | `#0D1B2A` | Navigation, hero sections, footer |
| `--dark-mid` | `#162236` | Secondary dark backgrounds |
| `--white` | `#FFFFFF` | Card surfaces, content areas |
| `--off-white` | `#FAF9F6` | Page background |
| `--text` | `#1A1A1A` | Body text |
| `--text-muted` | `#6B7280` | Secondary text, labels |

### Typography

- **Headings:** `font-family: var(--font-heading)` → Playfair Display (Google Fonts, already imported)
- **Body:** `font-family: var(--font-body)` → Inter
- Section titles use `clamp()` for fluid sizing, e.g. `font-size: clamp(1.8rem, 4vw, 2.8rem)`
- `<span>` inside headings gets `color: var(--gold)` for gold accent word

### Component Patterns

**Buttons** — always use `.btn` base + modifier:
```html
<button class="btn btn--gold">Primary</button>
<button class="btn btn--outline">Secondary</button>
<button class="btn btn--dark">Dark</button>
<button class="btn btn--danger">Danger</button>
<!-- Size modifiers: btn--sm  btn--lg -->
```

**Cards:**
```html
<div class="card">
  <div class="card-header"><strong>Title</strong></div>
  <div class="card-body">Content</div>
  <div class="card-footer">Footer</div>
</div>
```

**Section structure:**
```html
<section class="section" style="background:var(--white)">
  <div class="container">
    <div class="section-header">
      <span class="section-tag">Tag Label</span>
      <h2 class="section-title">Heading <span>Gold Word</span></h2>
      <p class="section-subtitle">Subtitle text</p>
    </div>
    <!-- content -->
  </div>
</section>
```

**Toasts (notifications):**
```js
showToast('Message here', 'success'); // success | error | info
```
The `#toastContainer` div must be present on any page using toasts.

**Page hero (inner pages):**
```html
<div class="page-hero">
  <div class="container">
    <div class="page-hero-tag"><i class="fas fa-icon"></i> &nbsp; Label</div>
    <h1 class="page-hero-title">Title</h1>
    <p class="page-hero-sub">Subtitle</p>
  </div>
</div>
```

**Badges:**
```html
<span class="badge badge--gold">Gold</span>
<span class="badge badge--success">OK</span>
<span class="badge badge--danger">Error</span>
<span class="badge badge--active">Live</span>
```

### Icons
Font Awesome 6.5.1 via CDN — already included on all pages:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
```
Golf-relevant icons: `fas fa-golf-ball-tee`, `fas fa-flag`, `fas fa-trophy`, `fas fa-crown`

### Responsive Breakpoints
- Mobile adjustments at `768px` — navbar collapses to hamburger, admin sidebar stacks
- Small mobile at `480px` — PIN digits shrink, 2-col score entry grid

---

## File Structure

```
lorgen-invitational/
├── server.js          ← Express server + all API routes
├── database.js        ← SQLite schema + db instance (imported by server)
├── package.json
├── .env               ← NOT committed (see .env.example)
├── .env.example       ← Template for env vars
├── .gitignore
├── data/              ← SQLite db file — NOT committed
├── uploads/           ← Photo uploads — NOT committed
└── public/
    ├── index.html         ← Homepage
    ├── gameday.html       ← Gameday info
    ├── scoreboard.html    ← Live scoreboard (SSE)
    ├── legacy.html        ← Hall of Fame
    ├── enter-score.html   ← PIN-protected player score entry
    ├── admin.html         ← Password-protected admin panel
    ├── css/
    │   └── style.css      ← Single shared stylesheet (all design here)
    └── images/
        └── logo.png       ← Tournament logo
```

**Rules:**
- All styles go in `public/css/style.css` — no per-page `<style>` blocks except for truly page-specific overrides
- All pages share the same navbar and footer HTML (duplicated — no templating engine)
- No JavaScript frameworks — vanilla JS only
- No separate JS files — page JS lives in a `<script>` tag at the bottom of each HTML file
- `database.js` is the only file that touches SQLite — never require `better-sqlite3` directly in `server.js`

---

## API Conventions

### URL Structure
```
GET/POST  /api/tournament          ← Public tournament info
GET       /api/scoreboard          ← Public scoreboard data
GET       /api/legacy              ← Public legacy entries
GET       /api/events              ← SSE stream

POST      /api/auth/team-login     ← Team PIN login
POST      /api/auth/admin-login    ← Admin password login
POST      /api/auth/logout
GET       /api/auth/status

GET       /api/team/scorecard      ← Requires team session
POST      /api/team/submit-score
POST      /api/team/upload-photo/:hole

GET/POST  /api/admin/*             ← Requires admin session
```

### Response Format
Always return JSON. On success:
```js
res.json({ success: true, data... })
```
On error:
```js
res.status(4xx).json({ error: 'Human-readable message' })
```

### Auth Guards
```js
const requireTeam  = (req, res, next) => req.session.teamId  ? next() : res.status(401).json({ error: '...' });
const requireAdmin = (req, res, next) => req.session.isAdmin ? next() : res.status(401).json({ error: '...' });
```

### Frontend `api()` Helper (admin.html pattern)
```js
async function api(url, options = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
```

### SSE Broadcasts
Call `broadcast(type, data)` in server.js after any write that should update the live scoreboard:
```js
broadcast('score_updated', { tournament_id });
broadcast('award_updated', {});
```
The scoreboard page listens for `score_updated` and `award_updated` events and re-fetches.

---

## Database Schema

Table relationships:
```
tournaments → holes (1:many, tournament_id)
tournaments → teams (1:many, tournament_id)
teams → scores (1:many, team_id)   UNIQUE(team_id, hole_number)
tournaments → awards (1:many)      UNIQUE(tournament_id, award_type, hole_number)
legacy (standalone, no FK)
```

Key columns:
- `tournaments.status` — `'upcoming'` | `'active'` | `'completed'`
- `holes.requires_photo` — `0` | `1` (integer boolean in SQLite)
- `scores.photo_path` — stored as `/uploads/filename.jpg` (web-accessible path)
- `teams.pin_code` — plain text 4-digit string (unique within tournament)

**Upsert pattern used throughout (prefer over separate INSERT + UPDATE):**
```js
db.prepare(`
  INSERT INTO scores (team_id, hole_number, score)
  VALUES (?, ?, ?)
  ON CONFLICT(team_id, hole_number) DO UPDATE SET score = excluded.score
`).run(teamId, holeNum, score);
```

---

## Environment Variables

```
PORT=3000
SESSION_SECRET=change-this-in-production
ADMIN_PASSWORD=LorgenAdmin2025
```

Default admin password is `LorgenAdmin2025` — always remind the user to change it in `.env` for production.

---

## Git & Workflow

### Branch naming
Feature branches must follow: `claude/<description>-<sessionId>`
Example: `claude/golf-tournament-website-nFXWG`

### Commit messages
- Imperative present tense: "Add award panel" not "Added award panel"
- First line: short summary (≤72 chars)
- Body: bullet list of what changed and why
- Always append session URL: `https://claude.ai/code/session_...`

### What NOT to commit
- `.env` (real credentials)
- `data/` (SQLite database)
- `uploads/` (user-uploaded photos)
- `node_modules/`

### Push command
```bash
git push -u origin claude/<branch-name>
```

---

## Development Notes

- Run with `npm start` (production) or `npm run dev` (nodemon watch mode)
- Server auto-creates `data/` and `uploads/` directories on first run
- SQLite uses WAL mode and foreign keys enabled — don't change these pragmas
- File uploads are limited to 15 MB, images only (`file.mimetype.startsWith('image/')`)
- SSE heartbeat runs every 25 seconds to keep connections alive through proxies
- Scoreboard also has a 60-second fallback `setInterval` poll in case SSE drops
