import crypto from 'crypto';
import { cookies } from 'next/headers';
import { env } from './env';

const COOKIE_NAME = 'admin_session';
const TTL_SECONDS = 60 * 60 * 8;

type SessionPayload = { role: 'admin'; exp: number };

function sign(value: string) {
  return crypto.createHmac('sha256', env.sessionSecret).update(value).digest('hex');
}

function encode(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(body);
  return `${body}.${signature}`;
}

function decode(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  if (sign(body) !== signature) return null;
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  if (parsed.exp < Date.now()) return null;
  return parsed;
}

export async function createAdminSession() {
  const payload: SessionPayload = { role: 'admin', exp: Date.now() + TTL_SECONDS * 1000 };
  const store = await cookies();
  store.set(COOKIE_NAME, encode(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: TTL_SECONDS
  });
}

export async function getAdminSession() {
  const store = await cookies();
  return decode(store.get(COOKIE_NAME)?.value);
}


export async function clearAdminSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 0
  });
}
