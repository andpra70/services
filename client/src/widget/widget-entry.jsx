import React from 'react';
import { createRoot } from 'react-dom/client';
import FileExplorerModal from '../components/explorer/FileExplorerModal';
import { createVolumes } from '../explorer/volumes';
import styles from './widget.css?inline';
import { createLegacyApi } from './legacy-api';

const globalObject = window;
let activePromise = null;
let api;

function parseOpenArguments(path, rawOptions) {
  const options = { mode: 'file', ...(rawOptions || {}) };
  if (!['file', 'directory', 'save'].includes(options.mode)) throw new Error('invalid_open_mode');
  if (Array.isArray(path)) path = path[0];
  let normalizedPath = typeof path === 'string' ? path.trim() : '';
  let volume = options.volume || null;
  const match = normalizedPath.match(/^(private|public):(.*)$/i);
  if (match) { volume = match[1].toLowerCase(); normalizedPath = match[2]; }
  normalizedPath = normalizedPath.replace(/^\/+|\/+$/g, '');
  if (!volume && normalizedPath) volume = globalObject.VfsAuth?.getSession?.() ? 'private' : 'public';
  if (options.mode === 'save') volume = 'private';
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
    root.render(<FileExplorerModal initialPath={initial.path} initialVolume={initial.volume} options={initial.options} volumes={createVolumes(globalObject, () => api)} onResolve={finish} />);
  });
  return activePromise;
}

api = createLegacyApi(globalObject, open);
globalObject.VfsWidget = api;
