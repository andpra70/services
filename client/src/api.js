import { normalizeVfsListing } from './models';

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
