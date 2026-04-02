import cors from 'cors';
import express from 'express';
import mime from 'mime-types';
import multer from 'multer';
import archiver from 'archiver';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPdfFromHtml } from './pdf.js';

const app = express();
const port = Number(process.env.PORT || 8080);
const volumeRoot = path.resolve(process.env.VOLUME_ROOT || '/mnt/data');
const maxEditableBytes = Number(process.env.MAX_EDITABLE_BYTES || 25 * 1024 * 1024);
const maxBinaryFileBytes = Number(process.env.MAX_BINARY_FILE_BYTES || 50 * 1024 * 1024);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const corsOriginList = parseCorsOrigins(corsOrigin);
const oauthIssuer = String(process.env.OAUTH_ISSUER || 'http://localhost:9000').replace(/\/+$/, '');
const oauthAllowSelfSignedTls = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.OAUTH_ALLOW_SELF_SIGNED_TLS || '').trim().toLowerCase()
);
const tokenValidationCacheTtlMs = Number(process.env.TOKEN_VALIDATION_CACHE_TTL_MS || 15_000);
const tokenValidationTimeoutMs = Number(process.env.TOKEN_VALIDATION_TIMEOUT_MS || 10_000);
const clientDistPath = path.resolve(
  process.env.CLIENT_DIST ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client-dist')
);
const appBase = normalizeAppBase(process.env.APP_BASE || '/');
const sharedApiAssetPath = path.join(clientDistPath, 'assets', 'api.js');
const publicReadOnlyPrefix = '/api/download';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBinaryFileBytes },
});
const tokenValidationCache = new Map();

if (oauthAllowSelfSignedTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('WARNING: TLS certificate validation disabled for outbound HTTPS requests (OAUTH_ALLOW_SELF_SIGNED_TLS=true)');
}

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });

  next();
});

app.use(
  cors({
    origin: createCorsOriginMatcher(corsOriginList),
  })
);
app.use(express.json({ limit: '10mb' }));
const binaryFileContentParser = express.raw({ type: '*/*', limit: `${maxBinaryFileBytes}b` });

function parseCorsOrigins(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createCorsOriginMatcher(allowedOrigins = []) {
  if (allowedOrigins.includes('*')) return true;
  const originSet = new Set(allowedOrigins);
  return (requestOrigin, callback) => {
    if (!requestOrigin) {
      callback(null, true);
      return;
    }
    callback(null, originSet.has(requestOrigin));
  };
}

function getBearerTokenFromRequest(req) {
  const value = String(req.get('authorization') || '').trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function headersToObject(headers) {
  const output = {};
  for (const [key, value] of headers.entries()) {
    output[key] = value;
  }
  return output;
}

async function validateAccessToken(token) {
  const tokenPrefix = token.slice(0, 8);
  console.debug('Validating access token (truncated):', `${tokenPrefix}...`);
  const cached = tokenValidationCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  const url = `${oauthIssuer}/me`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tokenValidationTimeoutMs);

  console.info('OAuth /me request start', {
    url,
    method: 'GET',
    timeoutMs: tokenValidationTimeoutMs,
    authorizationPrefix: `${tokenPrefix}...`,
  });

  let response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err?.name === 'AbortError') {
      console.warn('OAuth /me request timeout', { url, durationMs, timeoutMs: tokenValidationTimeoutMs });
      return null;
    }
    console.warn('OAuth /me request failed', {
      url,
      durationMs,
      name: err?.name || '',
      code: err?.code || err?.cause?.code || '',
      message: err?.message || String(err),
      cause: err?.cause?.message || '',
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const durationMs = Date.now() - startedAt;
  const responseHeaders = headersToObject(response.headers);
  let responseBody = '';
  try {
    responseBody = await response.text();
  } catch {
    responseBody = '';
  }

  console.info('OAuth /me response', {
    url,
    status: response.status,
    statusText: response.statusText,
    durationMs,
    headers: responseHeaders,
    bodyPreview: responseBody.slice(0, 500),
  });

  if (!response.ok) {
    console.warn('Bearer token rejected by OAuth /me', {
      status: response.status,
      statusText: response.statusText,
      oauthIssuer,
      wwwAuthenticate: response.headers.get('www-authenticate') || '',
      body: responseBody.slice(0, 500),
    });
    return null;
  }

  let profile = null;
  try {
    profile = responseBody ? JSON.parse(responseBody) : {};
  } catch {
    console.warn('OAuth /me returned non-JSON body for successful status', {
      oauthIssuer,
      bodyPreview: responseBody.slice(0, 500),
    });
    return null;
  }
  tokenValidationCache.set(token, {
    profile,
    expiresAt: Date.now() + tokenValidationCacheTtlMs,
  });
  console.debug('Validated access token (truncated):', `${tokenPrefix}...`);
  console.debug('Token validation response profile:', profile);
  return profile;
}

async function requireBearerAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (req.method === 'GET' && String(req.path || '').startsWith('/download/')) return next();

  const token = getBearerTokenFromRequest(req);
  if (!token) {
    return sendError(res, 'Missing bearer token', 401);
  }

  console.debug('Received bearer token for authentication (truncated):', token.slice(0, 4) + '...');

  try {
    const profile = await validateAccessToken(token);
    if (!profile) {
      return sendError(res, 'Invalid bearer token', 401);
    }
    req.authProfile = profile;
    try {
      req.authUser = getAuthenticatedUser(req);
    } catch (err) {
      return sendError(res, err, 401);
    }
    next();
  } catch (err) {
    sendError(res, 'Invalid bearer token', 401);
  }
}

app.use('/api', requireBearerAuth);

function normalizeAppBase(rawBase = '/') {
  const value = String(rawBase || '/').trim();
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

function toUnixPath(p) {
  return p.split(path.sep).join('/');
}

function sanitizeUsername(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
}

function sanitizeRelativePath(relativePath = '') {
  const raw = String(relativePath || '').trim();
  if (!raw || raw === '.') return '';
  return raw.replace(/^\/+|\/+$/g, '');
}

function resolveSafeAbsolutePath(userRoot, relativePath = '') {
  const cleanPath = sanitizeRelativePath(relativePath);
  const absolutePath = path.resolve(userRoot, cleanPath);
  const rootWithSep = userRoot.endsWith(path.sep) ? userRoot : `${userRoot}${path.sep}`;

  if (absolutePath !== userRoot && !absolutePath.startsWith(rootWithSep)) {
    throw new Error('Invalid path outside of mounted volume');
  }

  return absolutePath;
}

function toRelativePath(userRoot, absolutePath) {
  if (absolutePath === userRoot) return '';
  return toUnixPath(path.relative(userRoot, absolutePath));
}

async function ensureVolumeRoot() {
  const st = await fs.stat(volumeRoot);
  if (!st.isDirectory()) {
    throw new Error(`VOLUME_ROOT is not a directory: ${volumeRoot}`);
  }
}

async function ensureClientDist() {
  const st = await fs.stat(clientDistPath);
  if (!st.isDirectory()) {
    throw new Error(`CLIENT_DIST is not a directory: ${clientDistPath}`);
  }
}

async function ensureSharedApiAsset() {
  const st = await fs.stat(sharedApiAssetPath);
  if (!st.isFile()) {
    throw new Error(`Shared API asset not found: ${sharedApiAssetPath}`);
  }
}

function getAuthenticatedUser(req) {
  const profile = req.authProfile || {};
  const baseIdentity =
    profile.preferred_username ||
    profile.username ||
    (typeof profile.email === 'string' ? profile.email.split('@')[0] : '') ||
    profile.sub ||
    '';
  const username = sanitizeUsername(baseIdentity);
  console.debug('Authenticated user profile:', { profile, derivedUsername: username });
  if (!username) {
    throw new Error('Authenticated user is missing a valid username claim');
  }
  return { profile, username };
}

function getUserVolumeRoot(req) {
  const { username } = req.authUser || getAuthenticatedUser(req);
  return path.join(volumeRoot, username);
}

async function ensureUserVolumeRoot(req) {
  const userRoot = getUserVolumeRoot(req);
  await fs.mkdir(userRoot, { recursive: true });
  return userRoot;
}

async function listDirectory(userRoot, relativePath = '') {
  const absoluteDir = resolveSafeAbsolutePath(userRoot, relativePath);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  const detailed = await Promise.all(
    entries.map(async (entry) => {
      const abs = path.join(absoluteDir, entry.name);
      const st = await fs.stat(abs);
      return {
        name: entry.name,
        relativePath: toRelativePath(userRoot, abs),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: st.size,
        updatedAt: st.mtime.toISOString(),
      };
    })
  );

  detailed.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return detailed;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sendError(res, err, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

function detectMimeType(filePath) {
  return mime.lookup(filePath) || 'application/octet-stream';
}

function setCrossSiteAssetHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=300');
}

app.get(`${publicReadOnlyPrefix}/*`, async (req, res) => {
  try {
    const requestedPath = sanitizeRelativePath(req.params[0] || '');
    if (!requestedPath) {
      return sendError(res, 'Invalid file path', 400);
    }

    const fileAbs = resolveSafeAbsolutePath(volumeRoot, requestedPath);
    const st = await fs.stat(fileAbs);
    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    res.setHeader('Content-Type', detectMimeType(fileAbs));
    res.setHeader('Content-Disposition', 'inline');
    createReadStream(fileAbs).pipe(res);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, volumeRoot });
});

app.get('/api/list', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const currentPath = sanitizeRelativePath(req.query.path || '');
    const absolute = resolveSafeAbsolutePath(userRoot, currentPath);
    const st = await fs.stat(absolute);

    if (!st.isDirectory()) {
      return sendError(res, 'Path is not a directory', 400);
    }

    const items = await listDirectory(userRoot, currentPath);
    res.json({
      currentPath,
      parentPath: currentPath ? toUnixPath(path.dirname(currentPath)) === '.' ? '' : toUnixPath(path.dirname(currentPath)) : null,
      items,
    });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/folder', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const { path: currentPath = '', name } = req.body || {};
    if (!name || typeof name !== 'string') {
      return sendError(res, 'Folder name is required', 400);
    }

    const targetRelative = sanitizeRelativePath(path.join(sanitizeRelativePath(currentPath), name));
    const targetAbs = resolveSafeAbsolutePath(userRoot, targetRelative);
    await fs.mkdir(targetAbs, { recursive: false });
    res.status(201).json({ ok: true, relativePath: targetRelative });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const currentPath = sanitizeRelativePath(req.body.path || '');
    const targetDir = resolveSafeAbsolutePath(userRoot, currentPath);
    const st = await fs.stat(targetDir);

    if (!st.isDirectory()) {
      return sendError(res, 'Target path is not a directory', 400);
    }

    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return sendError(res, 'No files uploaded', 400);
    }

    await Promise.all(
      files.map(async (file) => {
        if (file.size > maxBinaryFileBytes) {
          throw new Error(`File too large (max ${maxBinaryFileBytes} bytes)`);
        }
        await fs.writeFile(resolveSafeAbsolutePath(userRoot, path.join(currentPath, file.originalname)), file.buffer);
      })
    );

    res.status(201).json({ ok: true, count: files.length });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const relativePath = sanitizeRelativePath(req.query.path || '');
    const fileAbs = resolveSafeAbsolutePath(userRoot, relativePath);
    const st = await fs.stat(fileAbs);

    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    const filename = path.basename(fileAbs);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(fileAbs).pipe(res);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/raw', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const relativePath = sanitizeRelativePath(req.query.path || '');
    const fileAbs = resolveSafeAbsolutePath(userRoot, relativePath);
    const st = await fs.stat(fileAbs);

    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    res.setHeader('Content-Type', detectMimeType(fileAbs));
    res.setHeader('Content-Disposition', 'inline');
    createReadStream(fileAbs).pipe(res);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/archive', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const { paths, archiveName } = req.body || {};
    if (!Array.isArray(paths) || paths.length === 0) {
      return sendError(res, 'paths must be a non-empty array', 400);
    }

    const sanitized = paths
      .map((item) => sanitizeRelativePath(item))
      .filter((item) => item.length > 0);

    if (sanitized.length === 0) {
      return sendError(res, 'No valid paths provided', 400);
    }

    const filename = `${String(archiveName || 'archive')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.zip$/i, '')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      if (!res.headersSent) {
        sendError(res, err, 500);
      } else {
        res.destroy(err);
      }
    });
    archive.pipe(res);

    for (const relativePath of sanitized) {
      const absolutePath = resolveSafeAbsolutePath(userRoot, relativePath);
      const st = await fs.stat(absolutePath);
      if (st.isDirectory()) {
        archive.directory(absolutePath, relativePath);
      } else {
        archive.file(absolutePath, { name: relativePath });
      }
    }

    await archive.finalize();
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.delete('/api/item', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const relativePath = sanitizeRelativePath(req.query.path || '');
    if (!relativePath) {
      return sendError(res, 'Cannot delete volume root', 400);
    }

    const itemAbs = resolveSafeAbsolutePath(userRoot, relativePath);
    await fs.rm(itemAbs, { recursive: true, force: false });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.patch('/api/rename', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const { path: relativePath, newName } = req.body || {};
    const cleanRelative = sanitizeRelativePath(relativePath || '');

    if (!cleanRelative) {
      return sendError(res, 'Invalid source path', 400);
    }
    if (!newName || typeof newName !== 'string') {
      return sendError(res, 'newName is required', 400);
    }

    const sourceAbs = resolveSafeAbsolutePath(userRoot, cleanRelative);
    const parentRel = toUnixPath(path.dirname(cleanRelative)) === '.' ? '' : toUnixPath(path.dirname(cleanRelative));
    const targetRel = sanitizeRelativePath(path.join(parentRel, newName));
    const targetAbs = resolveSafeAbsolutePath(userRoot, targetRel);

    await fs.rename(sourceAbs, targetAbs);
    res.json({ ok: true, relativePath: targetRel });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.patch('/api/move', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const { paths, targetPath = '' } = req.body || {};
    if (!Array.isArray(paths) || paths.length === 0) {
      return sendError(res, 'paths must be a non-empty array', 400);
    }

    const cleanTarget = sanitizeRelativePath(targetPath);
    const targetAbs = resolveSafeAbsolutePath(userRoot, cleanTarget);
    const targetStat = await fs.stat(targetAbs);
    if (!targetStat.isDirectory()) {
      return sendError(res, 'Target path is not a directory', 400);
    }

    const sanitizedPaths = [...new Set(paths.map((item) => sanitizeRelativePath(item)).filter(Boolean))];
    if (sanitizedPaths.length === 0) {
      return sendError(res, 'No valid paths provided', 400);
    }

    for (const sourcePath of sanitizedPaths) {
      const sourceAbs = resolveSafeAbsolutePath(userRoot, sourcePath);
      const sourceStat = await fs.stat(sourceAbs);
      const destinationRel = sanitizeRelativePath(path.join(cleanTarget, path.basename(sourcePath)));
      const destinationAbs = resolveSafeAbsolutePath(userRoot, destinationRel);

      if (destinationRel === sourcePath) {
        return sendError(res, `Source already in destination: ${sourcePath}`, 400);
      }

      const sourcePrefix = `${sourcePath}/`;
      if (sourceStat.isDirectory() && cleanTarget && (cleanTarget === sourcePath || cleanTarget.startsWith(sourcePrefix))) {
        return sendError(res, `Cannot move a folder into itself: ${sourcePath}`, 400);
      }

      if (await pathExists(destinationAbs)) {
        return sendError(res, `Destination already exists: ${destinationRel}`, 400);
      }
    }

    await Promise.all(
      sanitizedPaths.map(async (sourcePath) => {
        const sourceAbs = resolveSafeAbsolutePath(userRoot, sourcePath);
        const destinationRel = sanitizeRelativePath(path.join(cleanTarget, path.basename(sourcePath)));
        const destinationAbs = resolveSafeAbsolutePath(userRoot, destinationRel);
        await fs.rename(sourceAbs, destinationAbs);
      })
    );

    res.json({ ok: true, moved: sanitizedPaths.length, targetPath: cleanTarget });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/file-content', async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const relativePath = sanitizeRelativePath(req.query.path || '');
    const fileAbs = resolveSafeAbsolutePath(userRoot, relativePath);
    const st = await fs.stat(fileAbs);

    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    if (st.size > maxBinaryFileBytes) {
      return sendError(res, `File too large to read (max ${maxBinaryFileBytes} bytes)`, 413);
    }

    const content = await fs.readFile(fileAbs);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(content.byteLength));
    res.setHeader('X-File-Path', relativePath);
    res.send(content);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.put('/api/file-content', binaryFileContentParser, async (req, res) => {
  try {
    const userRoot = await ensureUserVolumeRoot(req);
    const relativePath = req.query.path || req.body?.path || '';
    const cleanRelative = sanitizeRelativePath(relativePath);
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!cleanRelative) {
      return sendError(res, 'Invalid file path', 400);
    }
    if (content.byteLength > maxBinaryFileBytes) {
      return sendError(res, `File too large to save (max ${maxBinaryFileBytes} bytes)`, 413);
    }

    const fileAbs = resolveSafeAbsolutePath(userRoot, cleanRelative);
    const st = await fs.stat(fileAbs);

    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    await fs.writeFile(fileAbs, content);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/print-pdf', async (req, res) => {
  try {
    const { html, filename } = req.body || {};
    const { filename: pdfFilename, pdfBuffer } = await renderPdfFromHtml(html, { filename });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    sendError(res, err, 400);
  }
});

const sharedApiAssetRoutes = ['/assets/api.js'];
if (appBase !== '/') {
  sharedApiAssetRoutes.push(`${appBase}assets/api.js`);
}

app.get(sharedApiAssetRoutes, (req, res, next) => {
  try {
    setCrossSiteAssetHeaders(res);
    res.type('application/javascript');
    res.sendFile(sharedApiAssetPath);
  } catch (err) {
    next(err);
  }
});

app.use(
  appBase,
  express.static(clientDistPath, {
    index: false,
  })
);

app.get(`${appBase === '/' ? '' : appBase}*`, async (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  try {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return sendError(res, `File too large (max ${maxBinaryFileBytes} bytes)`, 413);
  }
  if (err?.type === 'entity.too.large') {
    return sendError(res, `Request body too large (max ${maxBinaryFileBytes} bytes)`, 413);
  }
  next(err);
});

Promise.all([ensureVolumeRoot()])
  .then(() => {
    Promise.allSettled([ensureClientDist(), ensureSharedApiAsset()]).then((results) => {
      const hasStaticIssues = results.some((item) => item.status === 'rejected');
      if (hasStaticIssues) {
        console.warn('Static client assets not available at startup; API mode is still active.');
      }
    });

    app.listen(port, () => {
      console.log(`File server API listening on http://localhost:${port}`);
      console.log(`Mounted volume root: ${volumeRoot}`);
      console.log(`Serving client from ${clientDistPath} on base ${appBase}`);
      console.log(`Allowed CORS origins: ${corsOriginList.join(', ') || '(none)'}`);
      console.log(`OAuth issuer for bearer validation: ${oauthIssuer}`);
      console.log(`OAuth /me timeout (ms): ${tokenValidationTimeoutMs}`);
      console.log(`OAuth self-signed TLS allowed: ${oauthAllowSelfSignedTls}`);
    });
  })
  .catch((err) => {
    console.error('Startup error:', err.message);
    process.exit(1);
  });
