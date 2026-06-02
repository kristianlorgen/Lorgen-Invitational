# Restore sponsors/ads for Railway

This branch restores the old sponsor/advertising direction for the Railway deployment.

Use the Railway setup only:

- `api/index.js` is the backend entrypoint.
- `public/*.html` and `public/css/style.css` are the public/admin frontend.
- Supabase stores all sponsor/ad rows permanently.
- Supabase Storage stores uploaded sponsor logos/images.
- Do not add a Vercel/Next sponsor V2 for this restore.

Required data model:

- Hole sponsors: `tournament_id + hole_number`
- Page ads: `placement`, for example `frontpage`, `live_results`, `scorecard`, `admin`
- Sponsor fields: `sponsor_name`, `logo_path`/`sponsor_logo`, `sponsor_url`, `description`, `is_enabled`

The migration in `supabase/migrations/20260602_restore_sponsors_ads.sql` creates/hardens the `sponsors` table for the Railway Express API.

Short test list:

1. Run the Supabase migration.
2. In admin, select a tournament and add a frontpage ad.
3. Upload a sponsor logo and verify it goes to Supabase Storage.
4. Add a hole sponsor for a specific hole.
5. Verify frontpage, live results, scorecard and the per-hole scorecard view.
6. Refresh and confirm data is still stored in Supabase.
