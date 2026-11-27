import { normalizeVfsListing, parentDirectory, validateEntryName } from './models';
import { parsePreviewResponse } from './preview.js';

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
  if (!initialization) initialization = Promise.allSettled([
    loadScript('/auth/profile-widget.js', 'VfsAuth'),
    loadScript('/vfs/widget.js', 'VfsWidget'),
  ]).then((results) => {
    if (results[1].status === 'rejected') throw results[1].reason;
    return { authAvailable: results[0].status === 'fulfilled', localAvailable: Boolean(window.VfsWidget?.localVfs) };
  });
  return initialization;
}

export const getSession = () => window.VfsAuth?.getSession() || null;
export const login = () => window.VfsAuth?.login?.();
export const logout = () => window.VfsAuth?.logout?.();
const apiFor = (volume) => volume === 'local' ? window.VfsWidget.localVfs : window.VfsWidget;
const previewSignal = () => typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(120000) : undefined;
export const createDirectory = (path, volume = 'private') => apiFor(volume).mkdir(path);
export const uploadFile = (path, file, volume = 'private') => apiFor(volume).upload(path, file);

export function deleteItem(item, volume = 'private') {
  const api = apiFor(volume);
  return item.type === 'directory'
    ? api.rmdir(item.path, { recursive: true })
    : api.rmfile(item.path);
}

export function renameItem(item, requestedName, volume = 'private') {
  const name = validateEntryName(requestedName);
  const directory = parentDirectory(item.path);
  const targetPath = directory ? `${directory}/${name}` : name;
  return apiFor(volume).rename(item.path, targetPath, item.type);
}

export async function listDirectory(path = '') {
  return normalizeVfsListing(await window.VfsWidget.list(path));
}

export async function listLocalDirectory(path = '') {
  return normalizeVfsListing(await window.VfsWidget.localVfs.list(path));
}

const vfsBase = () => String(window.VFS_BASE_URL || '/vfs').replace(/\/+$/, '');
const encodePath = (value) => String(value || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');

export async function listPublicDirectory(path = '') {
  const encoded = encodePath(path);
  const response = await fetch(`${vfsBase()}/public/${encoded ? `${encoded}/` : ''}?vfs-list=2`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Elenco pubblico non disponibile (${response.status})`);
  return normalizeVfsListing(await response.json());
}

function publicFileUrl(path) {
  return `${vfsBase()}/public/${encodePath(path)}`;
}

async function saveResponse(response, name) {
  if (!response.ok) throw new Error(`Download non riuscito (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadFile(item) {
  const token = await window.VfsAuth.getAccessToken();
  const response = await fetch(window.VfsWidget.downloadUrl(item.path, true), { headers: { Authorization: `Bearer ${token}` } });
  await saveResponse(response, item.name);
}

export async function downloadLocalFile(item) {
  await saveResponse(await window.VfsWidget.localVfs.fetch(item.path), item.name);
}

export async function downloadPublicFile(item) {
  await saveResponse(await fetch(publicFileUrl(item.path)), item.name);
}

export async function loadFilePreview(item) {
  const token = await window.VfsAuth.getAccessToken();
  const response = await fetch(window.VfsWidget.downloadUrl(item.path, false), {
    headers: { Authorization: `Bearer ${token}` },
    signal: previewSignal(),
  });
  return parsePreviewResponse(response, item);
}

export async function loadLocalFilePreview(item) {
  return parsePreviewResponse(await window.VfsWidget.localVfs.fetch(item.path), item);
}

export async function loadPublicFilePreview(item) {
  return parsePreviewResponse(await fetch(publicFileUrl(item.path), { signal: previewSignal() }), item);
}
