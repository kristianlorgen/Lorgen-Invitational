# SQLite / better-sqlite3 Dependency Map

Generated on 2026-03-26 by repository inspection.

## 1) Direct imports/requires of `better-sqlite3`

- `database.js`
  - `const Database = require('better-sqlite3');`
  - This is the **only direct runtime import** of `better-sqlite3`.

## 2) Files and services that depend on SQLite

## Direct SQLite adapter

- `database.js`
  - Opens `./data/tournament.db` and initializes pragmas/schemas/migrations.
  - Exports `db` object used everywhere else.

## Core backend service (depends on `database.js`)

- `server.js`
  - Imports `db` from `./database` and uses SQLite for virtually all app data paths.
  - SQLite-backed helper functions:
    - `getActiveTournament`
    - `getScoreboardTournament`
    - `syncScorePhotoToGallery`
    - `rebuildPhotoDatabase`
    - sponsor lookup helpers and gallery/tournament resolver helpers

## API entrypoints that transitively depend on SQLite

- `api/index.js` and `api/[...route].js`
  - Both export `require('../server')`.
  - They are thin wrappers; all DB behavior comes from `server.js`.

## SQLite-backed API route groups in `server.js`

- Public read APIs:
  - `/api/version` (declares sqlite stack string)
  - `/api/tournament`, `/api/sponsors`, `/api/scoreboard`, `/api/legacy`
  - `/api/chat/messages`, `/api/gallery`
- Team/player write APIs:
  - `/api/auth/team-login` (team lookup)
  - `/api/team/scorecard`, `/api/team/submit-score`, `/api/team/upload-photo/:hole`
  - `/api/team/claim-award`, `/api/team/lock-scorecard`, `/api/team/birdie-shot`
- Admin CRUD APIs (all sqlite-backed):
  - tournaments, teams, holes, scores, sponsors, awards, courses, legacy
  - gallery moderation and photo publish/delete/download metadata operations
  - photo vote aggregation and toggling

## Non-SQLite data paths (for context)

- Coin-back image config (`/api/coin-back*`) uses `uploads/coin-back.json` on local disk (not sqlite).
- Upload file bytes are stored on local filesystem (`./uploads/*`), while metadata is still sqlite-backed.

## 3) Classification

## A. Critical runtime usage on Railway

**Yes — extensive and critical.** Railway runtime behavior currently relies on sqlite in live features:

- tournament discovery + scoreboard rendering
- team login and PIN validation
- score submission / updates
- awards and claims
- admin tournament/team/hole/course/legacy management
- chat message history
- gallery metadata and photo vote tracking
- sponsor placement configuration

All of the above execute through `server.js -> database.js -> better-sqlite3`.

## B. Unused legacy code

- Potentially unused/legacy regarding DB migration target:
  - `lib/supabaseClient.js`
  - `supabase.js`
- These initialize/export a Supabase client, but there are no imports of `./supabase` or `./lib/supabaseClient` from `server.js` or API handlers.
- Conclusion: Supabase integration exists as scaffold, not active runtime path.

## C. Code paths only used on Vercel

- `api/index.js`
- `api/[...route].js`

These files are Vercel-style entrypoints, but they still execute the same sqlite-dependent `server.js` app.
So they are **Vercel wrappers**, not sqlite-independent logic.

## 4) Does Railway currently depend on `better-sqlite3` for live features?

**Yes.** Railway currently depends on `better-sqlite3` for core live features.
Removing it now would break major functionality immediately.

## 5) Migration requirement before removal

Per current code state, sqlite is still active. Therefore:

1. Migrate all `server.js` data access (all `db.prepare`/`db.transaction` flows) to Supabase/Postgres.
2. Replace local-session and local-upload assumptions for production durability where needed.
3. Keep compatibility checks for `/api/scoreboard`, `/api/team/*`, and `/api/admin/*` as acceptance gates.
4. Only after parity is confirmed, remove `database.js` sqlite adapter and `better-sqlite3` dependency.

## 6) Safe removal status

`better-sqlite3` is **not safe to remove yet**.

No deletion/removal was performed in this pass.
