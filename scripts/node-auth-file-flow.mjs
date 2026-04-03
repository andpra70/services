#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const FILESERVER_BASE_URL = process.env.FILESERVER_BASE_URL || 'http://localhost:8080';
const API_BASE_URL = process.env.API_BASE_URL || `${FILESERVER_BASE_URL.replace(/\/+$/, '')}/api`;
const OAUTH_ISSUER = process.env.OAUTH_ISSUER || 'http://localhost:9000';
const TOKEN_URL = process.env.TOKEN_URL || `${OAUTH_ISSUER.replace(/\/+$/, '')}/token`;
const TOKEN_FORM =
  process.env.TOKEN_FORM ||
  'grant_type=password&client_id=fileserver-web&username=demo&password=demo&scope=openid%20profile%20email';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const ME_URL = process.env.ME_URL || `${OAUTH_ISSUER.replace(/\/+$/, '')}/me`;
const ALLOW_SELF_SIGNED_TLS = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ALLOW_SELF_SIGNED_TLS || '1').trim().toLowerCase()
);
const TARGET_DIR = process.env.TARGET_DIR || '';
const SOURCE_FILE = process.argv[2] || process.env.SOURCE_FILE || './README.md';
const UPLOAD_FILENAME = process.env.UPLOAD_FILENAME || path.basename(SOURCE_FILE);
const OUTPUT_DIR = process.env.OUTPUT_DIR || './tmp/node-demo';
const AUTH_DOWNLOAD_FILE =
  process.env.AUTH_DOWNLOAD_FILE || `${OUTPUT_DIR}/download-auth-${UPLOAD_FILENAME}`;
const PUBLIC_DOWNLOAD_FILE =
  process.env.PUBLIC_DOWNLOAD_FILE || `${OUTPUT_DIR}/download-public-${UPLOAD_FILENAME}`;

function sanitizeUsername(value = '') {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

function encodePath(p = '') {
  return encodeURIComponent(String(p)).replace(/%2F/g, '/');
}

function mustOk(res, bodyText) {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}\n${bodyText}`);
  }
}

async function main() {
  if (ALLOW_SELF_SIGNED_TLS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.warn('WARNING: TLS certificate validation disabled (ALLOW_SELF_SIGNED_TLS=true)');
  }

  await fs.access(SOURCE_FILE);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  let accessToken = ACCESS_TOKEN;
  if (!accessToken) {
    console.log(`1) Autenticazione OAuth su: ${TOKEN_URL}`);
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: TOKEN_FORM,
    });
    const tokenBody = await tokenRes.text();
    mustOk(tokenRes, tokenBody);
    const tokenJson = JSON.parse(tokenBody || '{}');
    accessToken = tokenJson.access_token || '';
    if (!accessToken) throw new Error('access_token non trovato nella risposta OAuth');
  } else {
    console.log('1) Access token gia\' fornito via env (ACCESS_TOKEN), salto chiamata /token');
  }

  console.log(`2) Lettura profilo utente da: ${ME_URL}`);
  const meRes = await fetch(ME_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const meBody = await meRes.text();
  mustOk(meRes, meBody);
  const me = JSON.parse(meBody || '{}');
  const userClaim =
    me.preferred_username || me.username || (typeof me.email === 'string' ? me.email.split('@')[0] : '') || me.sub || '';
  const sanitizedUser = sanitizeUsername(userClaim);
  if (!sanitizedUser) throw new Error('username non valido derivato da /me');

  const remoteRelativePath = TARGET_DIR ? `${TARGET_DIR.replace(/\/+$/, '')}/${UPLOAD_FILENAME}` : UPLOAD_FILENAME;
  const publicRelativePath = `${sanitizedUser}/${remoteRelativePath}`;
  const publicUrl = `${API_BASE_URL.replace(/\/+$/, '')}/download/${encodePath(publicRelativePath)}`;

  console.log('3) Lista file autenticata (GET /api/list?path=)');
  const listRes = await fetch(
    `${API_BASE_URL.replace(/\/+$/, '')}/list?path=${encodeURIComponent(TARGET_DIR)}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const listBody = await listRes.text();
  mustOk(listRes, listBody);
  console.log(listBody);

  console.log('4) Upload file autenticato (POST /api/upload)');
  const fileBuffer = await fs.readFile(SOURCE_FILE);
  const formData = new FormData();
  formData.set('path', TARGET_DIR);
  formData.set('files', new Blob([fileBuffer]), UPLOAD_FILENAME);
  const uploadRes = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  const uploadBody = await uploadRes.text();
  mustOk(uploadRes, uploadBody);
  console.log(uploadBody);

  console.log(`5) Download autenticato dello stesso file -> ${AUTH_DOWNLOAD_FILE}`);
  const authDownloadRes = await fetch(
    `${API_BASE_URL.replace(/\/+$/, '')}/download?path=${encodeURIComponent(remoteRelativePath)}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const authDownloadBody = await authDownloadRes.arrayBuffer();
  if (!authDownloadRes.ok) {
    throw new Error(`${authDownloadRes.status} ${authDownloadRes.statusText}\n${Buffer.from(authDownloadBody).toString('utf8')}`);
  }
  await fs.writeFile(AUTH_DOWNLOAD_FILE, Buffer.from(authDownloadBody));

  console.log(`6) Download pubblico SENZA token dello stesso file -> ${PUBLIC_DOWNLOAD_FILE}`);
  const publicDownloadRes = await fetch(publicUrl);
  const publicDownloadBody = await publicDownloadRes.arrayBuffer();
  if (!publicDownloadRes.ok) {
    throw new Error(
      `${publicDownloadRes.status} ${publicDownloadRes.statusText}\n${Buffer.from(publicDownloadBody).toString('utf8')}`
    );
  }
  await fs.writeFile(PUBLIC_DOWNLOAD_FILE, Buffer.from(publicDownloadBody));

  console.log('Flusso completato.');
  console.log(`- remote path utente : ${remoteRelativePath}`);
  console.log(`- public path        : ${publicRelativePath}`);
  console.log(`- url download public: ${publicUrl}`);
  console.log(`- file locale auth   : ${AUTH_DOWNLOAD_FILE}`);
  console.log(`- file locale public : ${PUBLIC_DOWNLOAD_FILE}`);
}

main().catch((err) => {
  console.error('Errore:', err.message || err);
  process.exit(1);
});
