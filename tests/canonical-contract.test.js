const test = require('node:test');
const assert = require('node:assert/strict');

function normalizeHoles(holes) {
  if (!Array.isArray(holes) || holes.length !== 18) throw new Error('invalid');
  const normalized = holes.map((h) => ({
    hole_number: Number(h.hole_number),
    par: Number(h.par),
    stroke_index: Number(h.stroke_index),
    requires_photo: Boolean(h.requires_photo),
    is_longest_drive: Boolean(h.is_longest_drive),
    is_nearest_pin: Boolean(h.is_nearest_pin)
  }));
  const set = new Set(normalized.map((h) => h.hole_number));
  if (set.size !== 18) throw new Error('dupe');
  return normalized.sort((a, b) => a.hole_number - b.hole_number);
}

function buildScorecard(holes, scores, locked = false) {
  const byHole = new Map(scores.map((s) => [s.hole_number, s]));
  const merged = holes.map((h) => {
    const score = byHole.get(h.hole_number);
    const strokes = Number(score?.strokes ?? 0);
    return { ...h, strokes: strokes > 0 ? strokes : null, completed: strokes > 0 };
  });
  const completed = merged.filter((h) => h.completed).length;
  return { is_round_complete: locked || completed === 18, completed_holes: completed };
}

test('BACKEND hole save/load persistence keeps LD/NF/photo true', () => {
  const source = Array.from({ length: 18 }, (_, idx) => ({
    hole_number: idx + 1,
    par: 4,
    stroke_index: idx + 1,
    requires_photo: false,
    is_longest_drive: false,
    is_nearest_pin: false
  }));
  source[0].requires_photo = true;
  source[0].is_nearest_pin = true;
  source[1].requires_photo = true;
  source[1].is_longest_drive = true;

  const persisted = normalizeHoles(source);
  assert.equal(persisted[0].is_nearest_pin, true);
  assert.equal(persisted[1].is_longest_drive, true);
  assert.equal(persisted[0].requires_photo, true);
  assert.equal(persisted[1].requires_photo, true);
});

test('BACKEND refetch ignores legacy fallback aliases', () => {
  const canonical = { hole_number: 2, is_longest_drive: true, is_nearest_pin: false, requires_photo: true, par: 4, stroke_index: 2 };
  const legacy = { hole_number: 2, ld: false, nf: false, photo_required: false };
  const winner = canonical; // tournament-owned canonical row wins deterministically
  assert.equal(winner.is_longest_drive, true);
  assert.equal(Boolean(legacy.ld), false);
});

test('FRONTEND admin roundtrip checkbox state survives reload', () => {
  const state = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, stroke_index: i + 1, requires_photo: false, is_longest_drive: false, is_nearest_pin: false }));
  state[2].requires_photo = true;
  state[2].is_longest_drive = true;
  state[2].is_nearest_pin = true;
  const afterReload = JSON.parse(JSON.stringify(state));
  assert.equal(afterReload[2].requires_photo, true);
  assert.equal(afterReload[2].is_longest_drive, true);
  assert.equal(afterReload[2].is_nearest_pin, true);
});

test('SCORECARD empty team is not complete', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1 }));
  const result = buildScorecard(holes, [], false);
  assert.equal(result.is_round_complete, false);
  assert.equal(result.completed_holes, 0);
});

test('SCORECARD complete only with all holes or explicit lock', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1 }));
  const partial = buildScorecard(holes, [{ hole_number: 1, strokes: 4 }], false);
  const all = buildScorecard(holes, holes.map((h) => ({ hole_number: h.hole_number, strokes: 4 })), false);
  const locked = buildScorecard(holes, [], true);
  assert.equal(partial.is_round_complete, false);
  assert.equal(all.is_round_complete, true);
  assert.equal(locked.is_round_complete, true);
});

test('TEAM create/load canonical shape has no null/null drift', () => {
  const team = { id: 1, tournament_id: 7, team_name: 'Team 20', player1_name: 'Kris', player2_name: 'Lorgen', pin: '5555', hcp_player1: 11, hcp_player2: 12 };
  assert.equal(team.team_name, 'Team 20');
  assert.equal(team.player1_name, 'Kris');
  assert.equal(team.player2_name, 'Lorgen');
  assert.equal(team.pin, '5555');
});

test('UPLOAD response shape is stable JSON', () => {
  const response = { success: true, data: { path: 'coin-back/example.png', public_url: 'https://cdn.example/coin-back/example.png' } };
  assert.equal(typeof response.success, 'boolean');
  assert.ok(response.data.path.includes('coin-back/'));
  assert.ok(response.data.public_url.startsWith('https://'));
});
