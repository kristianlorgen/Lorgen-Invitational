# CLAUDE.md — Lorgen Invitational

This file defines conventions for working on the Lorgen Invitational golf tournament website.
Read this before making any changes to the codebase.

---

## Project Overview

Annual 2-man scramble golf tournament website.
**Stack:** Node.js · Express · Supabase (Postgres) · Vanilla HTML/CSS/JS · Server-Sent Events

---

## Language

**All UI text must be in Norwegian Bokmål.** This includes:
- Navigation labels, buttons, headings, descriptions, error messages, toast notifications
- Admin panel labels, form fields, table headers, status messages
- Page titles, section headers, card content, footer links

Brand tagline stays in English: **"POWER. PRECISION. PARTY."**
Tournament name stays as-is: **Lorgen Invitational**
Golf terminology (Par, Birdie, Eagle, Bogey, Scramble) stays in standard usage.

### Key Norwegian Terms

| English | Norwegian |
|---|---|
| Home | Hjem |
| Gameday | Spilledag |
| Live Scoreboard | Live Resultattavle |
| Legacy / Hall of Fame | Historikk / Æresgalleri |
| Enter Score | Registrer Poeng |
| Admin Panel | Administrasjonspanel |
| Tournament | Turnering |
| Teams | Lag |
| Players | Spillere |
| Holes & Course | Hull og Bane |
| Scores | Poeng |
| Photos | Bilder |
| Awards | Utmerkelser |
| Longest Drive | Lengste Drive |
| Closest to Pin | Nærmest Flagget |
| Next Tournament | Neste Turnering |
| Reigning Champions | Regjerande Mestere |
| Date | Dato |
| Course | Bane |
| Year | År |
| Save | Lagre |
| Saved | Lagret |
| Delete | Slett |
| Edit | Rediger |
| Add | Legg til |
| Create | Opprett |
| Cancel | Avbryt |
| Update | Oppdater |
| Login | Logg inn |
| Logout | Logg ut |
| Password | Passord |
| Loading | Laster |
| Photo Challenge | Fotoutfordring |
| Upload photo | Last opp bilde |
| Overview | Oversikt |
| Schedule | Program |
| History | Historikk |
| Days | Dager |
| Hours | Timer |
| Minutes | Minutter |
| Seconds | Sekunder |

---

## Design System

### Brand Colors — always use CSS variables, never raw hex in HTML/JS

Logo palette: **white background, gold (#C9A84C) primary, dark navy (#0D1B2A) accents**

The overall site feel must be **white and gold** as the dominant palette. Dark navy is reserved for
the navbar, footer, countdown section, and trophy/award cards — NOT for page hero backgrounds.

| Variable | Hex | Use |
|---|---|---|
| `--gold` | `#C9A84C` | Primary accent — buttons, icons, highlights |
| `--gold-light` | `#E8C87A` | Hover states |
| `--gold-dark` | `#9A7B2E` | Text on light bg, secondary buttons |
| `--gold-pale` | `#FAF4E3` | Card backgrounds, page hero backgrounds |
| `--gold-border` | `#E5D9A9` | Borders, dividers |
| `--dark` | `#0D1B2A` | Navbar, countdown section, trophy cards, footer |
| `--dark-mid` | `#162236` | Secondary dark backgrounds |
| `--white` | `#FFFFFF` | Card surfaces, content areas, hero background |
| `--off-white` | `#FAF9F6` | Page background |
| `--text` | `#1A1A1A` | Body text |
| `--text-muted` | `#6B7280` | Secondary text, labels |

**Page Hero sections** (inner pages): gold-pale/white gradient, dark text — NOT dark navy.
**Homepage Hero**: white/cream background with gold shimmer — logo is designed for white bg.

### Typography

- **Headings:** `font-family: var(--font-heading)` → Playfair Display
- **Body:** `font-family: var(--font-body)` → Inter
- Section titles: `font-size: clamp(1.8rem, 4vw, 2.8rem)`
- `<span>` inside headings gets `color: var(--gold)`

### Component Patterns

**Buttons:**
```html
<button class="btn btn--gold">Primær</button>
<button class="btn btn--outline">Sekundær</button>
<button class="btn btn--dark">Mørk</button>
<button class="btn btn--danger">Slett</button>
```

**Section structure:**
```html
<section class="section" style="background:var(--white)">
  <div class="container">
    <div class="section-header">
      <span class="section-tag">Etikett</span>
      <h2 class="section-title">Overskrift <span>Gullord</span></h2>
      <p class="section-subtitle">Undertekst</p>
    </div>
  </div>
</section>
```

**Toasts:**
```js
showToast('Melding her', 'success'); // success | error | info
```

**Page hero (inner pages — light gold/white):**
```html
<div class="page-hero">
  <div class="container">
    <div class="page-hero-tag"><i class="fas fa-icon"></i> &nbsp; Etikett</div>
    <h1 class="page-hero-title">Tittel</h1>
    <p class="page-hero-sub">Undertekst</p>
  </div>
</div>
```

---

## Admin Panel Structure (Norwegian)

Sidebar order:

**Oversikt**
- Oversikt — dashboard showing Neste Turnering + Regjerande Mestere + quick stats

**Turnering**
- Turneringer — create/edit tournaments (navn, dato, bane, beskrivelse, status)
- Lag — add/edit teams with PIN codes
- Bane og Hull — configure par per hole, mark fotoutfordring holes
- Spilledag — edit gameday schedule / info text shown on the Spilledag page

**Aktiv Dag**
- Poeng — view/override all scores
- Bilder — view all uploaded hole photos
- Utmerkelser — assign Lengste Drive and Nærmest Flagget

**Historikk**
- Æresgalleri — manage Hall of Fame / Legacy entries

---

## File Structure

```
lorgen-invitational/
├── server.js          ← Express server + all API routes
├── package.json
├── .env               ← NOT committed
├── .env.example
├── .gitignore
├── data/              ← NOT committed
├── uploads/           ← NOT committed
└── public/
    ├── index.html         ← Hjemmeside
    ├── gameday.html       ← Spilledag informasjon
    ├── scoreboard.html    ← Live resultattavle (SSE)
    ├── legacy.html        ← Æresgalleri / Historikk
    ├── enter-score.html   ← Poengregistrering
    ├── admin.html         ← Administrasjonspanel
    ├── css/style.css      ← Single shared stylesheet
    └── images/logo.png
```

**Rules:**
- All styles in `public/css/style.css` — no per-page `<style>` blocks except page-specific overrides
- No JavaScript frameworks — vanilla JS only
- No separate JS files — page JS lives in `<script>` at bottom of each HTML file
- Bruk Supabase-klientlag for dataoperasjoner; unngå lokal DB-adapter

---

## API Conventions

```
GET/POST  /api/tournament          ← includes gameday_info field
GET       /api/scoreboard
GET       /api/legacy
GET       /api/events              ← SSE stream

POST      /api/auth/team-login
POST      /api/auth/admin-login
POST      /api/auth/logout
GET       /api/auth/status

GET       /api/team/scorecard
POST      /api/team/submit-score
POST      /api/team/upload-photo/:hole

GET/POST/PUT/DELETE  /api/admin/*
GET       /api/admin/tournament/:id/photos   ← all uploaded photos
```

Error messages returned as JSON must be in Norwegian.

### SSE Broadcasts
```js
broadcast('score_updated', { tournament_id });
broadcast('award_updated', {});
```

---

## Database Schema

```
tournaments  (id, year, name, date, course, description, gameday_info, status)
holes        (id, tournament_id, hole_number, par, requires_photo)
teams        (id, tournament_id, team_name, player1, player2, pin_code)
scores       (id, team_id, hole_number, score, photo_path, submitted_at)
awards       (id, tournament_id, award_type, team_id, hole_number, detail)
legacy       (id, year, winner_team, player1, player2, score, score_to_par, course, notes)
```

`gameday_info` — free text for the Spilledag page schedule/info.
`scores.photo_path` — stored as `/uploads/filename.jpg`

---

## Environment Variables

```
PORT=3000
SESSION_SECRET=change-this-in-production
ADMIN_PASSWORD=LorgenAdmin2025
```

---

## Git & Workflow

### Branch naming
`claude/<description>-<sessionId>`

### Commit messages
- Imperative present tense: "Add award panel"
- Append: `https://claude.ai/code/session_01PaBQbJ2b1RkRigDhKkZhfL`

### What NOT to commit
`.env` · `data/` · `uploads/` · `node_modules/`
