const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const supabaseAdmin = require('../lib/supabaseAdmin');

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload) { this.body = payload; }
  };
}

function createJsonReq(method, body, query = {}) {
  const stream = new Readable({ read() {} });
  if (body !== undefined) stream.push(JSON.stringify(body));
  stream.push(null);
  stream.method = method;
  stream.query = query;
  stream.headers = { 'content-type': 'application/json' };
  return stream;
}

function createReq(method, query = {}) {
  const stream = new Readable({ read() {} });
  stream.push(null);
  stream.method = method;
  stream.query = query;
  stream.headers = {};
  return stream;
}

test('active tournament route returns canonical JSON', async () => {
  supabaseAdmin.getSupabaseAdmin = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: { id: 1, year: 2026, name: 'Lorgen', date: null, course: null, status: 'active' }, error: null })
            })
          })
        })
      })
    })
  });

  const handler = require('../api/v2/tournaments/active');
  const req = createReq('GET');
  const res = createRes();
  await handler(req, res);

  const json = JSON.parse(res.body);
  assert.equal(json.success, true);
  assert.equal(json.data.id, 1);
});

test('teams GET and POST return canonical JSON', async () => {
  let inserted = null;
  supabaseAdmin.getSupabaseAdmin = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [{ id: 8, tournament_id: 1, team_name: 'A', player1_name: 'P1', player2_name: 'P2', pin: '1234', hcp_player1: 10, hcp_player2: 11 }], error: null })
        })
      }),
      insert: (payload) => {
        inserted = payload;
        return {
          select: () => ({
            single: async () => ({ data: { id: 9, ...payload }, error: null })
          })
        };
      }
    })
  });

  const handler = require('../api/v2/teams/index');

  const getReq = createReq('GET', { tournament_id: '1' });
  const getRes = createRes();
  await handler(getReq, getRes);
  const getJson = JSON.parse(getRes.body);
  assert.equal(getJson.success, true);
  assert.equal(getJson.data.length, 1);

  const postReq = createJsonReq('POST', {
    tournament_id: 1,
    team_name: 'B',
    player1_name: 'X',
    player2_name: 'Y',
    pin: '4321',
    hcp_player1: 9,
    hcp_player2: 8
  });
  const postRes = createRes();
  await handler(postReq, postRes);
  const postJson = JSON.parse(postRes.body);
  assert.equal(postJson.success, true);
  assert.equal(inserted.pin, '4321');
});

test('holes GET seeds and holes POST returns 18 rows', async () => {
  const eighteen = Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
    requires_photo: i === 0,
    is_longest_drive: false,
    is_nearest_pin: false
  }));

  supabaseAdmin.getSupabaseAdmin = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: eighteen, error: null })
        })
      }),
      upsert: async () => ({ error: null })
    })
  });

  const handler = require('../api/v2/tournaments/[id]/holes');

  const getReq = createReq('GET', { id: '1' });
  const getRes = createRes();
  await handler(getReq, getRes);
  const getJson = JSON.parse(getRes.body);
  assert.equal(getJson.data.length, 18);

  const postReq = createJsonReq('POST', { holes: eighteen }, { id: '1' });
  const postRes = createRes();
  await handler(postReq, postRes);
  const postJson = JSON.parse(postRes.body);
  assert.equal(postJson.success, true);
  assert.equal(postJson.data[0].requires_photo, true);
});

test('upload route returns JSON for method mismatch', async () => {
  const handler = require('../api/v2/uploads/coin-back');
  const req = createReq('GET');
  const res = createRes();
  await handler(req, res);

  const json = JSON.parse(res.body);
  assert.equal(res.statusCode, 405);
  assert.equal(json.success, false);
});
