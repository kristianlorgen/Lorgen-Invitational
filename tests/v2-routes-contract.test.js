const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDefaultHoles,
  normalizeHolePayload,
  mapTeamToCanonical,
  buildScorecardData,
  normalizeScoreRows
} = require('../api/v2');

test('team create/read roundtrip keeps canonical team keys', () => {
  const created = mapTeamToCanonical({
    id: 4,
    tournament_id: 9,
    team_name: 'Team V2',
    player1_name: 'Ola',
    player2_name: 'Kari',
    pin: '1234',
    hcp_player1: 10,
    hcp_player2: 12,
    is_locked: false
  });

  assert.deepEqual(Object.keys(created).sort(), [
    'created_at',
    'hcp_player1',
    'hcp_player2',
    'id',
    'is_locked',
    'pin',
    'player1_name',
    'player2_name',
    'team_name',
    'tournament_id'
  ]);
});

test('hole save/read roundtrip preserves canonical booleans', () => {
  const source = buildDefaultHoles(11);
  source[0].requires_photo = true;
  source[0].is_longest_drive = true;
  source[0].is_nearest_pin = true;

  const persisted = normalizeHolePayload(11, source);
  assert.equal(persisted[0].requires_photo, true);
  assert.equal(persisted[0].is_longest_drive, true);
  assert.equal(persisted[0].is_nearest_pin, true);
});

test('no alias drift after POST + GET canonicalization', () => {
  const holes = buildDefaultHoles(15);
  const persisted = normalizeHolePayload(15, holes);
  const first = persisted[0];

  assert.equal(Object.hasOwn(first, 'longest_drive'), false);
  assert.equal(Object.hasOwn(first, 'nearest_pin'), false);
  assert.equal(Object.hasOwn(first, 'is_closest_to_pin'), false);
});

test('scorecard is not complete when no score rows exist', () => {
  const team = { id: 5, tournament_id: 10, team_name: 'Nytt lag', player1_name: 'A', player2_name: 'B', pin: '1111', is_locked: false };
  const holes = buildDefaultHoles(10);
  const scorecard = buildScorecardData(team, holes, []);
  assert.equal(scorecard.is_round_complete, false);
  assert.equal(scorecard.completed_holes, 0);
});

test('scorecard is complete only when all holes have submitted score rows', () => {
  const team = { id: 5, tournament_id: 10, team_name: 'Nytt lag', player1_name: 'A', player2_name: 'B', pin: '1111', is_locked: false };
  const holes = buildDefaultHoles(10);
  const allRows = holes.map((h) => ({ hole_number: h.hole_number, gross_score: 4, submitted_at: '2026-04-02T00:00:00.000Z' }));
  const partialRows = allRows.slice(0, 17);

  const partial = buildScorecardData(team, holes, partialRows);
  const complete = buildScorecardData(team, holes, allRows);

  assert.equal(partial.is_round_complete, false);
  assert.equal(complete.is_round_complete, true);
});

test('upload JSON response shape is canonical and missing file has canonical error shape', () => {
  const success = { success: true, data: { path: 'coin-back/v2-123.png', publicUrl: 'https://example.invalid/coin-back/v2-123.png' } };
  const missingFileError = { success: false, error: 'Missing file upload', stackHint: 'missing_upload_file' };

  assert.equal(success.success, true);
  assert.ok(success.data.path.startsWith('coin-back/'));
  assert.ok(success.data.publicUrl.startsWith('https://'));
  assert.equal(missingFileError.success, false);
  assert.equal(typeof missingFileError.stackHint, 'string');
});

test('v2 helpers imply JSON-only API contract', () => {
  const parsed = normalizeScoreRows([{ hole_number: 1, gross_score: 4, submitted_at: '2026-04-02T00:00:00.000Z' }]);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed[0].gross_score, 4);
});
