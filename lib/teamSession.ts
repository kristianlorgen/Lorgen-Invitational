import crypto from 'crypto';
import { cookies } from 'next/headers';
import { env } from './env';

const COOKIE_NAME = 'team_session';
const TTL_SECONDS = 60 * 60 * 12;

type TeamSessionPayload = {
  type: 'team';
  team_id: string;
  tournament_id: string;
  pin?: string;
  exp: number;
};

function sign(value: string) {
  return crypto.createHmac('sha256', env.sessionSecret).update(value).digest('hex');
}

function encode(payload: TeamSessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode(token: string | undefined): TeamSessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  if (sign(body) !== signature) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TeamSessionPayload;
  if (payload.exp < Date.now()) return null;
  if (!payload.team_id || !payload.tournament_id) return null;
  return payload;
}

export async function createTeamSession(session: { team_id: string; tournament_id: string; pin?: string }) {
  const payload: TeamSessionPayload = {
    type: 'team',
    team_id: session.team_id,
    tournament_id: session.tournament_id,
    pin: session.pin,
    exp: Date.now() + TTL_SECONDS * 1000
  };

  const store = await cookies();
  store.set(COOKIE_NAME, encode(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: TTL_SECONDS
  });
}

export async function getTeamSession() {
  const store = await cookies();
  return decode(store.get(COOKIE_NAME)?.value);
}

export async function clearTeamSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 0
  });
}
