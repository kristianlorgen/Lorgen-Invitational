function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function ok(res, data, status = 200) {
  return sendJson(res, status, { success: true, data });
}

function fail(res, status, error, stackHint = 'v2_unknown') {
  return sendJson(res, status, {
    success: false,
    error: String(error || 'Unexpected server error'),
    stackHint: String(stackHint || 'v2_unknown')
  });
}

function methodNotAllowed(res, allowed = [], stackHint = 'method_not_allowed') {
  if (allowed.length > 0) {
    res.setHeader('Allow', allowed.join(', '));
  }
  return fail(res, 405, 'Method not allowed', stackHint);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (_error) {
    throw new Error('Invalid JSON body');
  }
}

module.exports = {
  sendJson,
  ok,
  fail,
  methodNotAllowed,
  readRawBody,
  readJsonBody
};
