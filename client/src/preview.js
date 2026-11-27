import { previewKindForEntry } from './models.js';

const MAX_TEXT_PREVIEW_BYTES = 50 * 1024 * 1024;
const LARGE_TEXT_BYTES = 256 * 1024;
const LARGE_TEXT_LINES = 5000;
const PREVIEW_TIMEOUT_MS = 120000;

function withTimeout(promise, message = 'Timeout durante il caricamento dell’anteprima') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), PREVIEW_TIMEOUT_MS); }),
  ]).finally(() => window.clearTimeout(timer));
}

export async function parsePreviewResponse(response, item) {
  if (!response.ok) throw new Error(`Anteprima non disponibile (${response.status})`);
  const blob = await withTimeout(response.blob());
  const contentType = response.headers.get('content-type') || blob.type;
  const kind = previewKindForEntry(item, contentType);
  if (kind === 'unsupported') throw new Error('Anteprima non supportata per questo tipo di file');

  if (kind === 'text' || kind === 'json') {
    if (blob.size > MAX_TEXT_PREVIEW_BYTES) throw new Error('Il file supera il limite di 50 MB per l’editor testuale');
    const rawText = await withTimeout(blob.text(), 'Timeout durante la lettura del file testuale');
    let lineCount = 1;
    for (let index = 0; index < rawText.length; index += 1) {
      if (rawText.charCodeAt(index) === 10) lineCount += 1;
    }
    const large = blob.size >= LARGE_TEXT_BYTES || lineCount >= LARGE_TEXT_LINES;
    if (kind === 'json' && !large) {
      try { return { kind, text: JSON.stringify(JSON.parse(rawText), null, 2), url: '', contentType }; }
      catch { return { kind, text: rawText, url: '', contentType, warning: 'JSON non valido: visualizzazione come testo.' }; }
    }
    return {
      kind, text: rawText, url: '', contentType, size: blob.size, lineCount, large,
      warning: large ? `Modalità file grande (${lineCount.toLocaleString()} righe): formattazione ed evidenziazione avanzata disattivate per mantenere l’editor reattivo.` : undefined,
    };
  }

  return { kind, text: '', contentType, url: URL.createObjectURL(blob) };
}
