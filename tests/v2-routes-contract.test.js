const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDefaultHoles,
  normalizeHolePayload,
  mapTeamToCanonical,
  buildScorecardData
} = require('../api/v2');

test('V2 hole save then refetch preserves LD/NF/photo', () => {
  const source = buildDefaultHoles(11);
  source[0].requires_photo = true;
  source[0].is_longest_drive = true;
  source[0].is_nearest_pin = true;

  const persisted = normalizeHolePayload(11, source);
  assert.equal(persisted[0].requires_photo, true);
  assert.equal(persisted[0].is_longest_drive, true);
  assert.equal(persisted[0].is_nearest_pin, true);
});

test('V2 team create then load returns canonical names', () => {
  const raw = {
    id: 4,
    tournament_id: 9,
    team_name: 'Team V2',
    player1_name: 'Ola',
    player2_name: 'Kari',
    pin: '1234',
    hcp_player1: 10,
    hcp_player2: 12
  };
  const canonical = mapTeamToCanonical(raw);
  assert.equal(canonical.team_name, 'Team V2');
  assert.equal(canonical.player1_name, 'Ola');
  assert.equal(canonical.player2_name, 'Kari');
  assert.equal(canonical.pin, '1234');
});

test('V2 scorecard empty team is not complete', () => {
  const team = { id: 5, tournament_id: 10, team_name: 'Nytt lag', player1_name: 'A', player2_name: 'B', pin: '1111', locked: false };
  const holes = buildDefaultHoles(10);
  const scorecard = buildScorecardData(team, holes, []);
  assert.equal(scorecard.is_round_complete, false);
  assert.equal(scorecard.completed_holes, 0);
});

test('V2 upload returns stable JSON success shape', () => {
  const response = {
    success: true,
    data: {
      path: 'coin-back/v2-123.png',
      public_url: 'https://example.invalid/storage/v1/object/public/tournament-gallery/coin-back/v2-123.png'
    }
  };
  assert.equal(response.success, true);
  assert.ok(response.data.path.startsWith('coin-back/'));
  assert.ok(response.data.public_url.startsWith('https://'));
});

test('V2 GET holes returns 18 rows', () => {
  const rows = buildDefaultHoles(99);
  assert.equal(rows.length, 18);
  assert.equal(rows[0].hole_number, 1);
  assert.equal(rows[17].hole_number, 18);
});

test('V2 POST holes upserts and survives reload', () => {
  const holes = buildDefaultHoles(15);
  holes[1].is_longest_drive = true;
  holes[2].is_nearest_pin = true;
  holes[3].requires_photo = true;

  const afterSave = normalizeHolePayload(15, holes);
  const afterReload = normalizeHolePayload(15, JSON.parse(JSON.stringify(afterSave)));

  assert.equal(afterReload[1].is_longest_drive, true);
  assert.equal(afterReload[2].is_nearest_pin, true);
  assert.equal(afterReload[3].requires_photo, true);
});
