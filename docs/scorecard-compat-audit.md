# Scorecard compatibility audit (Vercel + Supabase)

## Canonical storage bucket

- **Canonical bucket used by backend upload routes:** `tournament-gallery`
- **If missing, create it in Supabase Storage:**
  - `Create Supabase Storage bucket: tournament-gallery`
- **Error contract when missing bucket:** API now returns:
  - `code: STORAGE_BUCKET_NOT_FOUND`
  - `action: Create bucket: tournament-gallery`

## API routes involved

### Private scorecard + auth
- `POST /api/auth/team-login`
- `GET /api/auth/status`
- `GET /api/team/scorecard`
- `POST /api/team/submit-score`
- `POST /api/team/upload-photo/:holeNum`
- `POST /api/team/lock-scorecard`
- `POST /api/team/claim-award`

### Private chat + shoutout
- `GET /api/chat/messages`
- `POST /api/chat/send`
- `POST /api/team/birdie-shot`
- `GET /api/events`

### Supporting data for scorecard rendering
- `GET /api/sponsors`
- `GET /api/gallery`

## Required tables and columns (scorecard-related)

### `teams`
- `id`
- `tournament_id`
- `name` (or `team_name` for fallback compatibility)
- `pin` (or `pin_code` for fallback compatibility)
- `locked`

### `team_members`
- `team_id`
- `player_id` (used through relation)

### `players`
- `id`
- `name`
- `handicap`

### `tournaments`
- `id`
- `course_id` (fallback hole source)
- `slope_rating`

### `tournament_holes`
- `tournament_id`
- `hole_number`
- `par`
- `stroke_index`
- `requires_photo`
- `is_longest_drive`
- `is_closest_to_pin`

### `course_holes` (fallback if no tournament_holes)
- `course_id`
- `hole_number`
- `par`
- `stroke_index`
- `requires_photo`
- `is_longest_drive`
- `is_closest_to_pin`

### `scores`
- `id`
- `tournament_id`
- `team_id`
- `hole_number`
- `score`
- `par`
- `photo_path`
- `created_at`

### `award_claims`
- `id`
- `tournament_id`
- `team_id`
- `team_name`
- `hole_number`
- `award_type`
- `player_name`
- `detail`
- `value`
- `claimed_at`
- `created_at`

### `chat_messages`
- `id`
- `tournament_id`
- `team_id`
- `team_name`
- `message`
- `note`
- `image_path`
- `created_at`

### `sponsors` (optional but read by scorecard)
- `id`
- `tournament_id`
- `placement`
- `hole_number`
- `spot_number`
- `sponsor_name`
- `description`
- `logo_path`
- `is_enabled`

### `tournament_gallery_images` (gallery paths used around scorecard/photo area)
- `id`
- `tournament_id`
- `photo_path`
- `storage_path`
- `caption`
- `is_published`
- `uploaded_at`

## Storage paths used in the canonical bucket

- Canonical upload path (scorecard/chat/gallery): `tournament/<id>/team/<id>/hole/<holeOrContext>/<filename>`
- Scorecard hole photos: `tournament/<id>/team/<teamId>/hole/<holeNumber>/<filename>`
- Chat photos: `tournament/<id>/team/<teamId>/hole/chat/<filename>`
- Tournament gallery images: `tournament/<id>/team/0/hole/0/<filename>`
- Sponsor logos: `sponsors/tournament-<id>/...`
- Coin-back images: `coin-back/...`
- Legacy photos: `legacy/<id>/...`
