# Railway -> Vercel API Migration Map

This document maps old/legacy endpoints used by the admin/public frontend to the Vercel API surface (Express app exposed through `api/[...route].js`) and the Supabase tables they read/write.

## Auth

| Legacy behavior | Vercel route | Supabase access |
|---|---|---|
| Admin password login | `POST /api/auth/admin-login` | None (env `ADMIN_PASSWORD`) |
| Session status | `GET /api/auth/status` | None |
| Logout | `POST /api/auth/logout` | None |

## Tournaments

| Legacy behavior | Vercel route | Supabase access |
|---|---|---|
| List tournaments | `GET /api/admin/tournaments` | `tournaments` |
| Create tournament | `POST /api/admin/tournaments` (`/api/admin/tournament` alias) | `tournaments` |
| Tournament details | `GET /api/admin/tournaments/:id` | `tournaments` |
| Update tournament | `PATCH /api/admin/tournaments/:id` (`PUT /api/admin/tournament/:id` alias) | `tournaments` |
| Delete tournament | `DELETE /api/admin/tournaments/:id` (`DELETE /api/admin/tournament/:id` alias) | `tournaments` |
| Update gameday settings | `PUT /api/admin/tournament/:id/gameday` | `tournaments` |
| Update slope | `PUT /api/admin/tournament/:id/slope` | `tournaments` |

## Courses / Baner

| Legacy behavior | Vercel route | Supabase access |
|---|---|---|
| List courses | `GET /api/admin/courses` | `courses` |
| Create course | `POST /api/admin/courses` (`/api/admin/course` alias) | `courses`, `course_holes` |
| Course details | `GET /api/admin/courses/:id` (`/api/admin/course/:id` alias) | `courses`, `course_holes` |
| Update course | `PATCH /api/admin/courses/:id` (`PUT /api/admin/course/:id` alias) | `courses` |
| Delete course | `DELETE /api/admin/courses/:id` (`/api/admin/course/:id` alias) | `courses`, `course_holes` |

## Holes / Template Import

| Legacy behavior | Vercel route | Supabase access |
|---|---|---|
| Read course hole template | `GET /api/admin/courses/:id/holes` (`/api/admin/course/:id/holes` alias) | `course_holes` |
| Save course hole template | `POST /api/admin/courses/:id/holes` (`/api/admin/course/:id/holes` alias) | `course_holes` |
| Read tournament hole setup | `GET /api/admin/tournaments/:id/holes` (`/api/admin/tournament/:id/holes` alias) | `tournament_holes` |
| Save tournament hole setup | `POST /api/admin/tournaments/:id/holes` (`/api/admin/tournament/:id/holes` alias) | `tournament_holes` |
| Import course template into tournament | `POST /api/admin/tournaments/:id/import-course-template` | `course_holes`, `tournament_holes`, `tournaments` |

## Teams / Players / Scores

| Legacy behavior | Vercel route | Supabase access |
|---|---|---|
| List tournament teams | `GET /api/admin/teams?tournamentId=...` | `teams`, `team_members`, `players` |
| Create team | `POST /api/admin/teams` | `teams` |
| Team details | `GET /api/admin/teams/:id` | `teams`, `team_members`, `players` |
| Update team | `PATCH /api/admin/teams/:id` (`PUT /api/admin/team/:id`, `/api/admin/team/:id/lock` aliases) | `teams` |
| Delete team | `DELETE /api/admin/teams/:id` | `teams`, `team_members`, `scores` |
| Add player to team | `POST /api/admin/teams/:id/players` and `POST /api/teams/:id/add-player` | `team_members`, `players`, `teams` |
| List players | `GET /api/admin/players` | `players` |
| Create player | `POST /api/admin/players` | `players` |
| Update/delete player | `PATCH/DELETE /api/admin/players/:id` | `players`, `team_members` |
| List scores | `GET /api/admin/scores` or `GET /api/admin/tournament/:id/scores` | `scores`, `teams` |
| Create score | `POST /api/admin/scores` | `scores` |
| Update/delete score | `PATCH/DELETE /api/admin/scores/:id` (`PUT/DELETE /api/admin/score/:id` aliases) | `scores` |

## Public data loaders

| Frontend call | Vercel route |
|---|---|
| Home tournament card | `GET /api/tournament` |
| Live scoreboard | `GET /api/scoreboard` |
| Teams | `GET /api/teams` |
| Players | `GET /api/players` |

## 404 hardening

All unknown `/api/*` paths now return JSON `404` payloads instead of HTML fallback pages.
