import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_WEASYPRINT_CANDIDATES = [
  process.env.WEASYPRINT_BIN,
  '/usr/bin/weasyprint',
  'weasyprint',
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

async function resolveWeasyprintExecutable() {
  for (const candidate of DEFAULT_WEASYPRINT_CANDIDATES) {
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

  throw new Error('WeasyPrint executable not found');
}

function sanitizePdfFilename(filename = 'document.pdf') {
  const safeBase = String(filename || 'document.pdf')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.pdf$/i, '');

  return `${safeBase || 'document'}.pdf`;
}

export async function renderPdfFromHtml(html, options = {}) {
  const weasyprintExecutable = await resolveWeasyprintExecutable();
  const filename = sanitizePdfFilename(options.filename);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileserver-pdf-'));
  const htmlPath = path.join(tempDir, 'document.html');
  const pdfPath = path.join(tempDir, filename);

  try {
    await fs.writeFile(htmlPath, normalizeHtmlDocument(html), 'utf8');

    await execFileAsync(weasyprintExecutable, [
      '--media-type',
      'print',
      htmlPath,
      pdfPath,
    ]);

    const pdfBuffer = await fs.readFile(pdfPath);
    return { filename, pdfBuffer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF render failed: ${message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
