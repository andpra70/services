import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_BIN,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
  'chromium-browser',
  'chromium',
].filter(Boolean);

function normalizeHtmlDocument(html) {
  const source = String(html || '').trim();
  if (!source) {
    throw new Error('html is required');
  }

  if (/<html[\s>]/i.test(source)) {
    return source;
  }

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${source}</body></html>`;
}

async function resolveChromiumExecutable() {
  for (const candidate of DEFAULT_CHROMIUM_CANDIDATES) {
    if (!candidate.startsWith('/')) {
      return candidate;
    }

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error('Chromium executable not found');
}

function sanitizePdfFilename(filename = 'document.pdf') {
  const safeBase = String(filename || 'document.pdf')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.pdf$/i, '');

  return `${safeBase || 'document'}.pdf`;
}

export async function renderPdfFromHtml(html, options = {}) {
  const chromiumExecutable = await resolveChromiumExecutable();
  const filename = sanitizePdfFilename(options.filename);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileserver-pdf-'));
  const htmlPath = path.join(tempDir, 'document.html');
  const pdfPath = path.join(tempDir, filename);
  const runtimeDir = path.join(tempDir, 'runtime');
  const userDataDir = path.join(tempDir, 'profile');

  try {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(htmlPath, normalizeHtmlDocument(html), 'utf8');

    await execFileAsync(chromiumExecutable, [
      '--headless',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-crash-reporter',
      '--disable-features=MediaRouter',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-pings',
      '--no-proxy-server',
      '--no-zygote',
      '--allow-file-access-from-files',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=2000',
      '--print-to-pdf-no-header',
      `--user-data-dir=${userDataDir}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ], {
      env: {
        ...process.env,
        HOME: tempDir,
        XDG_RUNTIME_DIR: runtimeDir,
        DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      },
    });

    const pdfBuffer = await fs.readFile(pdfPath);
    return { filename, pdfBuffer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF render failed: ${message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
