import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';

import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';

import {
  WEBAPP_AUTH_MODE,
  WEBAPP_DEV_EMAIL,
  WEBAPP_DEV_ROLE,
  WEBAPP_DEV_USER_ID,
  WEBAPP_DEV_USER_NAME,
  WEBAPP_ENTRA_CLIENT_ID,
  WEBAPP_ENTRA_CLIENT_SECRET,
  WEBAPP_ENTRA_TENANT_ID,
  WEBAPP_PUBLIC_BASE_URL,
  WEBAPP_SESSION_SECRET,
} from '../config.js';
import { WebWorkspaceRole } from '../types.js';
import { normalizeWorkspaceRole } from '../web/workspaces.js';

const SESSION_COOKIE = 'agentos_web_session';
const OAUTH_STATE_COOKIE = 'agentos_web_state';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthenticatedBrowserUser {
  tenantId: string;
  userId: string;
  displayName: string;
  email?: string;
  role: WebWorkspaceRole;
}

export interface BrowserSession extends AuthenticatedBrowserUser {
  issuedAt: string;
  expiresAt: string;
}

function requireSessionSecret(): string {
  if (!WEBAPP_SESSION_SECRET) {
    throw new Error('WEBAPP_SESSION_SECRET must be configured for the web app');
  }
  return WEBAPP_SESSION_SECRET;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function hmacSign(value: string): string {
  return base64url(createHmac('sha256', requireSessionSecret()).update(value).digest());
}

function signPayload(payload: unknown): string {
  const encoded = base64url(JSON.stringify(payload));
  const signature = hmacSign(encoded);
  return `${encoded}.${signature}`;
}

function verifyPayload<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = hmacSign(encoded);
  const valid =
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};

  return header.split(';').reduce<Record<string, string>>((acc, entry) => {
    const [key, ...rest] = entry.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    httpOnly?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    secure?: boolean;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function appendSetCookie(res: ServerResponse, value: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
    return;
  }

  res.setHeader('Set-Cookie', [String(existing), value]);
}

function getSecureCookieFlag(): boolean {
  return WEBAPP_PUBLIC_BASE_URL.startsWith('https://');
}

export function getSessionFromRequest(req: IncomingMessage): BrowserSession | null {
  const cookies = parseCookies(req);
  const session = verifyPayload<BrowserSession>(cookies[SESSION_COOKIE]);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return session;
}

export function setSessionCookie(
  res: ServerResponse,
  session: BrowserSession,
): void {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE, signPayload(session), {
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      sameSite: 'Lax',
      secure: getSecureCookieFlag(),
    }),
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE, '', {
      maxAge: 0,
      sameSite: 'Lax',
      secure: getSecureCookieFlag(),
    }),
  );
}

export function setOAuthStateCookie(res: ServerResponse, state: string): void {
  appendSetCookie(
    res,
    serializeCookie(OAUTH_STATE_COOKIE, state, {
      maxAge: 10 * 60,
      sameSite: 'Lax',
      secure: getSecureCookieFlag(),
    }),
  );
}

export function clearOAuthStateCookie(res: ServerResponse): void {
  appendSetCookie(
    res,
    serializeCookie(OAUTH_STATE_COOKIE, '', {
      maxAge: 0,
      sameSite: 'Lax',
      secure: getSecureCookieFlag(),
    }),
  );
}

function resolveRoleFromClaims(claims: JWTPayload): WebWorkspaceRole {
  const roles = Array.isArray(claims.roles)
    ? claims.roles.map((role) => String(role))
    : [];

  if (roles.includes('AgentOS.Admin') || roles.includes('Admin')) {
    return 'Admin';
  }
  if (roles.includes('AgentOS.Operator') || roles.includes('Operator')) {
    return 'Operator';
  }
  return 'Viewer';
}

export function createBrowserSession(
  user: AuthenticatedBrowserUser,
): BrowserSession {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  return {
    ...user,
    issuedAt,
    expiresAt,
  };
}

export function createDevUser(
  query: URLSearchParams,
): AuthenticatedBrowserUser {
  return {
    tenantId: query.get('tenantId') || 'dev-tenant',
    userId: query.get('userId') || WEBAPP_DEV_USER_ID,
    displayName: query.get('name') || WEBAPP_DEV_USER_NAME,
    email: query.get('email') || WEBAPP_DEV_EMAIL || undefined,
    role: normalizeWorkspaceRole(query.get('role') || WEBAPP_DEV_ROLE),
  };
}

export function buildEntraLoginUrl(): {
  authorizationUrl: string;
  state: string;
} {
  if (
    !WEBAPP_ENTRA_TENANT_ID ||
    !WEBAPP_ENTRA_CLIENT_ID ||
    !WEBAPP_ENTRA_CLIENT_SECRET
  ) {
    throw new Error('Entra auth is enabled but required env vars are missing');
  }

  const state = signPayload({
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const redirectUri = `${WEBAPP_PUBLIC_BASE_URL}/auth/callback`;
  const url = new URL(
    `https://login.microsoftonline.com/${WEBAPP_ENTRA_TENANT_ID}/oauth2/v2.0/authorize`,
  );
  url.searchParams.set('client_id', WEBAPP_ENTRA_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);

  return { authorizationUrl: url.toString(), state };
}

export function getOAuthStateFromRequest(req: IncomingMessage): string | null {
  return parseCookies(req)[OAUTH_STATE_COOKIE] || null;
}

export async function exchangeEntraCodeForUser(
  code: string,
): Promise<AuthenticatedBrowserUser> {
  const tenantId = WEBAPP_ENTRA_TENANT_ID;
  const clientId = WEBAPP_ENTRA_CLIENT_ID;
  const clientSecret = WEBAPP_ENTRA_CLIENT_SECRET;
  const redirectUri = `${WEBAPP_PUBLIC_BASE_URL}/auth/callback`;

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        scope: 'openid profile email',
      }),
    },
  );

  if (!tokenResponse.ok) {
    throw new Error(`Entra token exchange failed (${tokenResponse.status})`);
  }

  const tokenJson = (await tokenResponse.json()) as {
    id_token?: string;
  };
  if (!tokenJson.id_token) {
    throw new Error('Entra token exchange did not return an id_token');
  }

  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/discovery/v2.0/keys`),
  );
  const { payload } = await jwtVerify(tokenJson.id_token, jwks, {
    issuer,
    audience: clientId,
  });

  return {
    tenantId: String(payload.tid || tenantId),
    userId: String(payload.oid || payload.sub),
    displayName: String(payload.name || payload.preferred_username || payload.sub),
    email:
      typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : typeof payload.email === 'string'
          ? payload.email
          : undefined,
    role: resolveRoleFromClaims(payload),
  };
}

export function getAuthMode(): 'dev' | 'entra' {
  return WEBAPP_AUTH_MODE === 'entra' ? 'entra' : 'dev';
}
