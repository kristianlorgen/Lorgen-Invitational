const crypto = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_COOKIE_NAME = 'admin_auth';
const ADMIN_COOKIE_TTL_SECONDS = 60 * 60 * 12; // 12 timer
const ADMIN_SIGNING_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_SIGNING_SECRET || ADMIN_PASSWORD || 'lorgen-admin';

function signAdminCookieValue(payload) {
  const hmac = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

function verifyAdminCookieValue(value) {
  if (!value || !value.includes('.')) return false;
  const idx = value.lastIndexOf('.');
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const [issuedAtRaw] = payload.split(':');
  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAt)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  return ageSeconds >= 0 && ageSeconds <= ADMIN_COOKIE_TTL_SECONDS;
}

function readCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, pair) => {
    const [key, ...parts] = pair.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(parts.join('='));
    return acc;
  }, {});
}

function setAdminAuthCookie(res) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = signAdminCookieValue(`${issuedAt}:admin`);
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${ADMIN_COOKIE_TTL_SECONDS}; SameSite=Lax${secureFlag}`);
}

function clearAdminAuthCookie(res) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`);
}

function isAdminAuthenticated(req) {
  const cookies = readCookies(req);
  return verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
}

function getAdminPassword() {
  return ADMIN_PASSWORD;
}

module.exports = {
  clearAdminAuthCookie,
  getAdminPassword,
  isAdminAuthenticated,
  setAdminAuthCookie
};
