const OAUTH_BASE = import.meta.env.VITE_OAUTH_BASE || '/oauth';
const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID || 'fileserver-web';
const configuredAppBase = import.meta.env.VITE_APP_BASE || import.meta.env.BASE_URL || './';

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizePathname(value) {
  if (!value || value === '/') return '/';
  return ensureTrailingSlash(`/${value.replace(/^\/+|\/+$/g, '')}`);
}

function computeCurrentAppBasePath() {
  const pathname = window.location.pathname || '/';
  if (pathname.endsWith('/callback')) {
    return normalizePathname(pathname.slice(0, -'/callback'.length));
  }
  return pathname.endsWith('/') ? pathname : normalizePathname(pathname);
}

function resolveAppBasePath() {
  if (!configuredAppBase || configuredAppBase === '.' || configuredAppBase === './') {
    return computeCurrentAppBasePath();
  }

  try {
    return normalizePathname(new URL(configuredAppBase, window.location.href).pathname);
  } catch {
    return computeCurrentAppBasePath();
  }
}

const appBasePath = resolveAppBasePath();
const REDIRECT_URI =
  import.meta.env.VITE_OAUTH_REDIRECT_URI || new URL('callback', `${window.location.origin}${appBasePath}`).toString();
const redirectPathname = new URL(REDIRECT_URI).pathname;
const LOGOUT_REDIRECT_URI =
  import.meta.env.VITE_OAUTH_LOGOUT_REDIRECT_URI || `${window.location.origin}${appBasePath}`;
const SCOPE = import.meta.env.VITE_OAUTH_SCOPE || 'openid profile email offline_access';

const ACCESS_TOKEN_KEY = 'fs_access_token';
const REFRESH_TOKEN_KEY = 'fs_refresh_token';
const ID_TOKEN_KEY = 'fs_id_token';
const EXPIRES_AT_KEY = 'fs_expires_at';
const STATE_KEY = 'fs_oauth_state';
const CODE_VERIFIER_KEY = 'fs_oauth_verifier';
const RETURN_TO_KEY = 'fs_return_to';

function base64UrlEncode(bytes) {
  let str = '';
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });

  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

function setTokens(tokens) {
  const expiresIn = Number(tokens.expires_in || 3600);
  const expiresAt = Date.now() + Math.max(60, expiresIn - 30) * 1000;
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token || '');
  if (tokens.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
  if (tokens.id_token) {
    localStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  } else {
    localStorage.removeItem(ID_TOKEN_KEY);
  }
  localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(CODE_VERIFIER_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
}

function getExpiresAt() {
  return Number(localStorage.getItem(EXPIRES_AT_KEY) || '0');
}

function getAccessTokenStored() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

function getRefreshTokenStored() {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || '';
}

function getIdTokenStored() {
  return localStorage.getItem(ID_TOKEN_KEY) || '';
}

export async function redirectToLogin() {
  const state = randomString(20);
  const verifier = randomString(48);
  const challenge = await sha256Base64Url(verifier);

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(CODE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(RETURN_TO_KEY, `${window.location.pathname}${window.location.search}`);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.assign(`${OAUTH_BASE}/auth?${params.toString()}`);
}

async function exchangeToken(formData) {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData,
  });

  if (!res.ok) {
    let details = '';
    try {
      const payload = await res.json();
      details = [payload?.error, payload?.error_description].filter(Boolean).join(': ');
    } catch {
      try {
        details = await res.text();
      } catch {
        details = '';
      }
    }
    throw new Error(`OAuth token exchange failed (${res.status})${details ? ` - ${details}` : ''}`);
  }

  const payload = await res.json();
  if (!payload.access_token) {
    throw new Error('Missing access token in OAuth response');
  }

  setTokens(payload);
}

export async function handleCallbackIfPresent() {
  const url = new URL(window.location.href);
  const callbackPathname = new URL(REDIRECT_URI).pathname;
  const isCallback = url.pathname === callbackPathname;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!isCallback || !code) return false;

  const expectedState = sessionStorage.getItem(STATE_KEY) || '';
  const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY) || '';
  if (!expectedState || !verifier || state !== expectedState) {
    throw new Error('Invalid OAuth callback state');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  await exchangeToken(body);

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(CODE_VERIFIER_KEY);

  const returnTo = sessionStorage.getItem(RETURN_TO_KEY) || appBasePath;
  sessionStorage.removeItem(RETURN_TO_KEY);
  window.history.replaceState(null, '', returnTo === callbackPathname ? appBasePath : returnTo);

  return true;
}

async function refreshAccessToken() {
  const refreshToken = getRefreshTokenStored();
  if (!refreshToken) return false;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  try {
    await exchangeToken(body);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export async function getValidAccessToken() {
  const token = getAccessTokenStored();
  const expiresAt = getExpiresAt();

  if (token && Date.now() < expiresAt) {
    return token;
  }

  const refreshed = await refreshAccessToken();
  if (refreshed) {
    return getAccessTokenStored();
  }

  return '';
}

export async function ensureAuthenticated() {
  await handleCallbackIfPresent();

  const token = await getValidAccessToken();
  if (token) return true;

  await redirectToLogin();
  return false;
}

export function logout() {
  const idTokenHint = getIdTokenStored();
  clearTokens();

  const params = new URLSearchParams({
    post_logout_redirect_uri: LOGOUT_REDIRECT_URI,
    client_id: CLIENT_ID,
  });
  if (idTokenHint) {
    params.set('id_token_hint', idTokenHint);
  }

  window.location.assign(`${OAUTH_BASE}/session/end?${params.toString()}`);
}
