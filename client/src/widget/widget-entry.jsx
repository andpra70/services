import React from 'react';
import { createRoot } from 'react-dom/client';
import FileExplorerModal from '../components/explorer/FileExplorerModal';
import { createVolumes } from '../explorer/volumes';
import styles from './widget.css?inline';
import { createLegacyApi } from './legacy-api';

const globalObject = window;
let activePromise = null;
let api;

const locationStorageKey = globalObject.VFS_EXPLORER_STORAGE_KEY || 'vfs.explorer.location.v1';

function readStoredLocation() {
  try {
    const value = JSON.parse(globalObject.localStorage.getItem(locationStorageKey) || 'null');
    if (!value || !['private', 'public'].includes(value.volume)) return null;
    return { volume: value.volume, path: String(value.path || '').replace(/^\/+|\/+$/g, '') };
  } catch {
    return null;
  }
}

function storeLocation(location) {
  try {
    globalObject.localStorage.setItem(locationStorageKey, JSON.stringify({
      volume: location.volume,
      path: String(location.path || '').replace(/^\/+|\/+$/g, ''),
    }));
  } catch { /* localStorage may be disabled */ }
}

function parseOpenArguments(path, rawOptions) {
  const options = { mode: 'file', ...(rawOptions || {}) };
  if (!['file', 'directory', 'save'].includes(options.mode)) throw new Error('invalid_open_mode');
  const hasExplicitLocation = (path !== undefined && path !== null) || Boolean(options.volume);
  if (Array.isArray(path)) path = path[0];
  let normalizedPath = typeof path === 'string' ? path.trim() : '';
  let volume = options.volume || null;
  const match = normalizedPath.match(/^(private|public):(.*)$/i);
  if (match) { volume = match[1].toLowerCase(); normalizedPath = match[2]; }
  normalizedPath = normalizedPath.replace(/^\/+|\/+$/g, '');
  if (!hasExplicitLocation) {
    const stored = readStoredLocation();
    if (stored) ({ volume, path: normalizedPath } = stored);
  }
  if (!volume && normalizedPath) volume = globalObject.VfsAuth?.getSession?.() ? 'private' : 'public';
  if (options.mode === 'save') volume = 'private';
  if (volume === 'private' && !globalObject.VfsAuth?.getSession?.()) {
    volume = null;
    normalizedPath = '';
  }
  return { path: normalizedPath, volume, options };
}

function open(path, options) {
  if (activePromise) return activePromise;
  const initial = parseOpenArguments(path, options);
  activePromise = new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'vfs-widget-explorer-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    document.body.appendChild(host);
    const root = createRoot(mount);
    const finish = (result) => {
      root.unmount(); host.remove(); activePromise = null; resolve(result);
    };
    root.render(<FileExplorerModal initialPath={initial.path} initialVolume={initial.volume} options={initial.options} volumes={createVolumes(globalObject, () => api)} onLocationChange={storeLocation} onResolve={finish} />);
  });
  return activePromise;
}

api = createLegacyApi(globalObject, open);
globalObject.VfsWidget = api;
