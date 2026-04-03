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


function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function parseBody(res) {
  assert.match(res.headers['content-type'] || '', /application\/json/i);
  const payload = JSON.parse(res.body);
  assert.equal(typeof payload.success, 'boolean');
  return payload;
}

test('health route returns JSON-only envelope', async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  supabaseAdmin.getSupabaseAdmin = () => ({ from: () => ({}) });

  const handler = loadFresh('../api/v2/health');
  const req = createReq('GET');
  const res = createRes();
  await handler(req, res);

  const json = parseBody(res);
  assert.equal(json.success, true);
  assert.equal(json.data.status, 'ok');
});

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

  const handler = loadFresh('../api/v2/tournaments/active');
  const req = createReq('GET');
  const res = createRes();
  await handler(req, res);

  const json = parseBody(res);
  assert.equal(json.success, true);
  assert.equal(json.data.id, 1);
});

test('teams GET empty list keeps JSON contract', async () => {
  supabaseAdmin.getSupabaseAdmin = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null })
        })
      })
    })
  });

  const handler = loadFresh('../api/v2/teams/index');
  const req = createReq('GET', { tournament_id: '1' });
  const res = createRes();
  await handler(req, res);

  const json = parseBody(res);
  assert.deepEqual(json, { success: true, data: [] });
});

test('teams POST create + GET returns canonical row only', async () => {
  const rows = [];
  supabaseAdmin.getSupabaseAdmin = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: rows, error: null })
        })
      }),
      insert: (payload) => ({
        select: () => ({
          single: async () => {
            const inserted = { id: 9, ...payload };
            rows.push(inserted);
            return { data: inserted, error: null };
          }
        })
      })
    })
  });

  const handler = loadFresh('../api/v2/teams/index');

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
  const postJson = parseBody(postRes);
  assert.equal(postJson.success, true);
  assert.deepEqual(Object.keys(postJson.data).sort(), [
    'hcp_player1',
    'hcp_player2',
    'id',
    'pin',
    'player1_name',
    'player2_name',
    'team_name',
    'tournament_id'
  ]);

  const getReq = createReq('GET', { tournament_id: '1' });
  const getRes = createRes();
  await handler(getReq, getRes);
  const getJson = parseBody(getRes);
  assert.equal(getJson.success, true);
  assert.equal(getJson.data.length, 1);
  assert.equal(getJson.data[0].team_name, 'B');
});

test('holes GET returns exactly 18 rows', async () => {
  const eighteen = Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
    requires_photo: false,
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

  const handler = loadFresh('../api/v2/tournaments/[id]/holes');

  const getReq = createReq('GET', { id: '1' });
  const getRes = createRes();
  await handler(getReq, getRes);
  const getJson = parseBody(getRes);
  assert.equal(getJson.success, true);
  assert.equal(getJson.data.length, 18);
});

test('holes POST persists LD/NF/photo flags', async () => {
  const eighteen = Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
    requires_photo: i === 0,
    is_longest_drive: i === 1,
    is_nearest_pin: i === 2
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

  const handler = loadFresh('../api/v2/tournaments/[id]/holes');
  const postReq = createJsonReq('POST', { holes: eighteen }, { id: '1' });
  const postRes = createRes();
  await handler(postReq, postRes);
  const postJson = parseBody(postRes);

  assert.equal(postJson.success, true);
  assert.equal(postJson.data[0].requires_photo, true);
  assert.equal(postJson.data[1].is_longest_drive, true);
  assert.equal(postJson.data[2].is_nearest_pin, true);
});

test('upload route returns canonical JSON shape', async () => {
  process.env.SUPABASE_STORAGE_BUCKET = 'uploads';

  supabaseAdmin.getSupabaseAdmin = () => ({
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'coin-back/test.png' }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.invalid/coin-back/test.png' } })
      })
    }
  });

  const handler = loadFresh('../api/v2/uploads/coin-back');
  const req = createReq('POST');
  req.body = { tournament_id: '1' };
  req.file = {
    originalname: 'coin.png',
    mimetype: 'image/png',
    buffer: Buffer.from('image-bytes')
  };
  const res = createRes();
  await handler(req, res);

  const json = parseBody(res);
  assert.equal(json.success, true);
  assert.equal(typeof json.data.path, 'string');
  assert.equal(typeof json.data.public_url, 'string');
});

test('upload route always emits JSON error for method mismatch', async () => {
  const handler = loadFresh('../api/v2/uploads/coin-back');
  const req = createReq('GET');
  const res = createRes();
  await handler(req, res);

  const json = parseBody(res);
  assert.equal(res.statusCode, 405);
  assert.equal(json.success, false);
  assert.equal(typeof json.stackHint, 'string');
});

test('admin-v2 safe wrapper guards against non-JSON and direct response.json usage', async () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/admin-v2.html', 'utf8');

  assert.match(html, /async function fetchJson\(/);
  assert.match(html, /response\.text\(\)/);
  assert.match(html, /content-type/);
  assert.match(html, /API returned non-JSON from/);
  assert.doesNotMatch(html, /response\.json\(\)/);
});
