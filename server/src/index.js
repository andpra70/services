import cors from 'cors';
import express from 'express';
import mime from 'mime-types';
import multer from 'multer';
import archiver from 'archiver';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 8080);
const volumeRoot = path.resolve(process.env.VOLUME_ROOT || '/mnt/data');
const maxEditableBytes = Number(process.env.MAX_EDITABLE_BYTES || 1024 * 1024);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const clientDistPath = path.resolve(
  process.env.CLIENT_DIST ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client-dist')
);
const appBase = normalizeAppBase(process.env.APP_BASE || '/');

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '10mb' }));

function normalizeAppBase(rawBase = '/') {
  const value = String(rawBase || '/').trim();
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

function toUnixPath(p) {
  return p.split(path.sep).join('/');
}

function sanitizeRelativePath(relativePath = '') {
  const raw = String(relativePath || '').trim();
  if (!raw || raw === '.') return '';
  return raw.replace(/^\/+|\/+$/g, '');
}

function resolveSafeAbsolutePath(relativePath = '') {
  const cleanPath = sanitizeRelativePath(relativePath);
  const absolutePath = path.resolve(volumeRoot, cleanPath);
  const rootWithSep = volumeRoot.endsWith(path.sep) ? volumeRoot : `${volumeRoot}${path.sep}`;

  if (absolutePath !== volumeRoot && !absolutePath.startsWith(rootWithSep)) {
    throw new Error('Invalid path outside of mounted volume');
  }

  return absolutePath;
}

function toRelativePath(absolutePath) {
  if (absolutePath === volumeRoot) return '';
  return toUnixPath(path.relative(volumeRoot, absolutePath));
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

async function listDirectory(relativePath = '') {
  const absoluteDir = resolveSafeAbsolutePath(relativePath);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  const detailed = await Promise.all(
    entries.map(async (entry) => {
      const abs = path.join(absoluteDir, entry.name);
      const st = await fs.stat(abs);
      return {
        name: entry.name,
        relativePath: toRelativePath(abs),
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

function sendError(res, err, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

function detectMimeType(filePath) {
  return mime.lookup(filePath) || 'application/octet-stream';
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, volumeRoot });
});

app.get('/api/list', async (req, res) => {
  try {
    const currentPath = sanitizeRelativePath(req.query.path || '');
    const absolute = resolveSafeAbsolutePath(currentPath);
    const st = await fs.stat(absolute);

    if (!st.isDirectory()) {
      return sendError(res, 'Path is not a directory', 400);
    }

    const items = await listDirectory(currentPath);
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
    const { path: currentPath = '', name } = req.body || {};
    if (!name || typeof name !== 'string') {
      return sendError(res, 'Folder name is required', 400);
    }

    const targetRelative = sanitizeRelativePath(path.join(sanitizeRelativePath(currentPath), name));
    const targetAbs = resolveSafeAbsolutePath(targetRelative);
    await fs.mkdir(targetAbs, { recursive: false });
    res.status(201).json({ ok: true, relativePath: targetRelative });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const currentPath = sanitizeRelativePath(req.body.path || '');
    const targetDir = resolveSafeAbsolutePath(currentPath);
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
        const targetAbs = resolveSafeAbsolutePath(path.join(currentPath, file.originalname));
        await fs.writeFile(targetAbs, file.buffer);
      })
    );

    res.status(201).json({ ok: true, count: files.length });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const relativePath = sanitizeRelativePath(req.query.path || '');
    const fileAbs = resolveSafeAbsolutePath(relativePath);
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
    const relativePath = sanitizeRelativePath(req.query.path || '');
    const fileAbs = resolveSafeAbsolutePath(relativePath);
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
      const absolutePath = resolveSafeAbsolutePath(relativePath);
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
    const relativePath = sanitizeRelativePath(req.query.path || '');
    if (!relativePath) {
      return sendError(res, 'Cannot delete volume root', 400);
    }

    const itemAbs = resolveSafeAbsolutePath(relativePath);
    await fs.rm(itemAbs, { recursive: true, force: false });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.patch('/api/rename', async (req, res) => {
  try {
    const { path: relativePath, newName } = req.body || {};
    const cleanRelative = sanitizeRelativePath(relativePath || '');

    if (!cleanRelative) {
      return sendError(res, 'Invalid source path', 400);
    }
    if (!newName || typeof newName !== 'string') {
      return sendError(res, 'newName is required', 400);
    }

    const sourceAbs = resolveSafeAbsolutePath(cleanRelative);
    const parentRel = toUnixPath(path.dirname(cleanRelative)) === '.' ? '' : toUnixPath(path.dirname(cleanRelative));
    const targetRel = sanitizeRelativePath(path.join(parentRel, newName));
    const targetAbs = resolveSafeAbsolutePath(targetRel);

    await fs.rename(sourceAbs, targetAbs);
    res.json({ ok: true, relativePath: targetRel });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/file-content', async (req, res) => {
  try {
    const relativePath = sanitizeRelativePath(req.query.path || '');
    const fileAbs = resolveSafeAbsolutePath(relativePath);
    const st = await fs.stat(fileAbs);

    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    if (st.size > maxEditableBytes) {
      return sendError(res, `File too large to edit (max ${maxEditableBytes} bytes)`, 413);
    }

    const content = await fs.readFile(fileAbs, 'utf8');
    res.json({ path: relativePath, content, size: st.size });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.put('/api/file-content', async (req, res) => {
  try {
    const { path: relativePath, content } = req.body || {};
    const cleanRelative = sanitizeRelativePath(relativePath || '');

    if (!cleanRelative) {
      return sendError(res, 'Invalid file path', 400);
    }
    if (typeof content !== 'string') {
      return sendError(res, 'content must be a string', 400);
    }

    const fileAbs = resolveSafeAbsolutePath(cleanRelative);
    const st = await fs.stat(fileAbs);

    if (!st.isFile()) {
      return sendError(res, 'Path is not a file', 400);
    }

    await fs.writeFile(fileAbs, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 400);
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

Promise.all([ensureVolumeRoot(), ensureClientDist()])
  .then(() => {
    app.listen(port, () => {
      console.log(`File server API listening on http://localhost:${port}`);
      console.log(`Mounted volume root: ${volumeRoot}`);
      console.log(`Serving client from ${clientDistPath} on base ${appBase}`);
    });
  })
  .catch((err) => {
    console.error('Startup error:', err.message);
    process.exit(1);
  });
