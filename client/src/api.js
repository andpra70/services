import { normalizeVfsListing, parentDirectory, previewKindForEntry, validateEntryName } from './models';

const MAX_TEXT_PREVIEW_BYTES = 5 * 1024 * 1024;

let initialization;

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Impossibile caricare ${src}`));
    document.head.appendChild(script);
  });
}

export function initializeVfs() {
  if (!initialization) initialization = loadScript('/auth/widget.js', 'VfsAuth').then(() => loadScript('/vfs/widget.js', 'VfsWidget'));
  return initialization;
}

export const getSession = () => window.VfsAuth?.getSession() || null;
export const login = () => window.VfsAuth.login();
export const logout = () => window.VfsAuth.logout();
export const createDirectory = (path) => window.VfsWidget.mkdir(path);
export const uploadFile = (path, file) => window.VfsWidget.upload(path, file);

export function deleteItem(item) {
  return item.type === 'directory'
    ? window.VfsWidget.rmdir(item.path, { recursive: true })
    : window.VfsWidget.rmfile(item.path);
}

export function renameItem(item, requestedName) {
  const name = validateEntryName(requestedName);
  const directory = parentDirectory(item.path);
  const targetPath = directory ? `${directory}/${name}` : name;
  return window.VfsWidget.rename(item.path, targetPath, item.type);
}

export async function listDirectory(path = '') {
  return normalizeVfsListing(await window.VfsWidget.list(path));
}

export async function downloadFile(item) {
  const token = await window.VfsAuth.getAccessToken();
  const response = await fetch(window.VfsWidget.downloadUrl(item.path, true), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Download non riuscito (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = item.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function loadFilePreview(item) {
  const token = await window.VfsAuth.getAccessToken();
  const response = await fetch(window.VfsWidget.downloadUrl(item.path, false), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Anteprima non disponibile (${response.status})`);

  const blob = await response.blob();
  const kind = previewKindForEntry(item, response.headers.get('content-type') || blob.type);
  if (kind === 'unsupported') {
    throw new Error('Anteprima non supportata per questo tipo di file');
  }

  if (kind === 'text' || kind === 'json') {
    if (blob.size > MAX_TEXT_PREVIEW_BYTES) {
      throw new Error('Il file supera il limite di 5 MB per l’anteprima testuale');
    }
    const rawText = await blob.text();
    if (kind === 'json') {
      try {
        return { kind, text: JSON.stringify(JSON.parse(rawText), null, 2), url: '' };
      } catch {
        return { kind, text: rawText, url: '', warning: 'JSON non valido: visualizzazione come testo.' };
      }
    }
    return { kind, text: rawText, url: '' };
  }

  return { kind, text: '', url: URL.createObjectURL(blob) };
}
