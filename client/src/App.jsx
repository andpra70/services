import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createArchive,
  createFolder,
  deleteItem,
  downloadFile,
  listDirectory,
  loadFileContent,
  loadRawFileBlob,
  moveItems,
  renameItem,
  saveFileContent,
  uploadFiles,
} from './api';

function stripTrailingSlashes(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLoopbackHost(hostname = '') {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isLocalhostIssuer(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(resolveAbsoluteUrl(raw), window.location.origin);
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function resolveAbsoluteUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) || value.startsWith('//')) return value;
  if (value.startsWith('/')) return new URL(value, window.location.origin).toString();
  if (value.includes('.')) return `https://${value}`;
  return new URL(value, window.location.origin).toString();
}

function resolveOAuthIssuer(rawIssuer) {
  const isLocalDevHost = isLoopbackHost(window.location.hostname);
  const fallbackIssuer = isLocalDevHost ? 'http://localhost:9000' : `${window.location.origin}/oauth-server`;
  const shouldIgnoreIssuer = !isLocalDevHost && isLocalhostIssuer(rawIssuer);
  const resolved = resolveAbsoluteUrl(shouldIgnoreIssuer ? fallbackIssuer : (rawIssuer || fallbackIssuer)) || fallbackIssuer;
  return stripTrailingSlashes(resolved);
}

function resolveOAuthWidgetUrl(rawUrl, issuer) {
  const shouldIgnoreWidgetUrl = !isLoopbackHost(window.location.hostname) && isLocalhostIssuer(rawUrl);
  const resolved = resolveAbsoluteUrl(shouldIgnoreWidgetUrl ? '' : rawUrl);
  if (resolved) return stripTrailingSlashes(resolved);
  return `${issuer}/app/assets/authWidget.js`;
}

function resolveOAuthRedirectUri(rawValue) {
  const resolved = resolveAbsoluteUrl(rawValue);
  if (resolved) return resolved;
  return `${window.location.origin}${window.location.pathname}`;
}

const OAUTH_ISSUER = resolveOAuthIssuer(import.meta.env.VITE_OAUTH_ISSUER);
const OAUTH_CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID || 'fileserver-web';
const OAUTH_SCOPE = import.meta.env.VITE_OAUTH_SCOPE || 'openid profile email offline_access';
const OAUTH_WIDGET_URL = resolveOAuthWidgetUrl(import.meta.env.VITE_OAUTH_COMPONENT_URL, OAUTH_ISSUER);
const OAUTH_REDIRECT_URI = resolveOAuthRedirectUri(import.meta.env.VITE_OAUTH_REDIRECT_URI);
const OAUTH_EVENT_NAME = 'oauth-widget:profile';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'sh', 'py']);
const INLINE_EDITABLE_EXTENSIONS = new Set(['html', 'txt', 'json', 'js']);
let oauthWidgetScriptPromise = null;

function loadOAuthWidgetScript() {
  if (oauthWidgetScriptPromise) return oauthWidgetScriptPromise;

  oauthWidgetScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-auth-widget="true"][src="${OAUTH_WIDGET_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Impossibile caricare authWidget.js')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = OAUTH_WIDGET_URL;
    script.type = 'module';
    script.dataset.authWidget = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Impossibile caricare authWidget.js')), { once: true });
    document.head.append(script);
  });

  return oauthWidgetScriptPromise;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const p = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** p;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[p]}`;
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString();
}

function splitSegments(currentPath) {
  if (!currentPath) return [];
  const parts = currentPath.split('/').filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join('/'),
  }));
}

function getFileExtension(name) {
  const parts = name.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

function getSortValue(item, sortBy) {
  if (sortBy === 'size_asc' || sortBy === 'size_desc') return item.size;
  if (sortBy === 'date_asc' || sortBy === 'date_desc') return Date.parse(item.updatedAt);
  return item.name.toLowerCase();
}

function compareItems(a, b, sortBy) {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;

  const aValue = getSortValue(a, sortBy);
  const bValue = getSortValue(b, sortBy);

  if (sortBy.endsWith('_desc')) {
    if (aValue < bValue) return 1;
    if (aValue > bValue) return -1;
    return 0;
  }

  if (aValue < bValue) return -1;
  if (aValue > bValue) return 1;
  return 0;
}

function detectPreviewKind(item) {
  if (!item || item.type === 'directory') return null;
  const ext = getFileExtension(item.name);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function hasFilesInDataTransfer(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes('Files');
}

function isInteractiveElement(target) {
  return target instanceof Element && Boolean(target.closest('button, input, select, textarea, a, label'));
}

function Icon({ name }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    refresh: [<path key="1" d="M21 12a9 9 0 1 1-3-6.7" />, <polyline key="2" points="21 3 21 9 15 9" />],
    home: [<path key="1" d="M3 11l9-8 9 8" />, <path key="2" d="M5 10v10h14V10" />],
    up: [<polyline key="1" points="18 15 12 9 6 15" />],
    folderPlus: [<path key="1" d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />, <path key="2" d="M12 12v6" />, <path key="3" d="M9 15h6" />],
    upload: [<path key="1" d="M12 16V4" />, <polyline key="2" points="7 9 12 4 17 9" />, <path key="3" d="M4 20h16" />],
    selectAll: [<rect key="1" x="4" y="4" width="16" height="16" rx="2" />, <path key="2" d="M8 12l3 3 5-6" />],
    clear: [<path key="1" d="M6 6l12 12" />, <path key="2" d="M18 6L6 18" />],
    zip: [<path key="1" d="M8 3h8l3 3v15H5V3h3" />, <path key="2" d="M12 5v10" />, <path key="3" d="M10 9h4" />],
    trash: [<polyline key="1" points="3 6 5 6 21 6" />, <path key="2" d="M8 6V4h8v2" />, <path key="3" d="M6 6l1 14h10l1-14" />],
    open: [<path key="1" d="M14 3h7v7" />, <path key="2" d="M10 14L21 3" />, <path key="3" d="M21 14v7H3V3h7" />],
    download: [<path key="1" d="M12 4v12" />, <polyline key="2" points="7 11 12 16 17 11" />, <path key="3" d="M4 20h16" />],
    eye: [<path key="1" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />, <circle key="2" cx="12" cy="12" r="3" />],
    edit: [<path key="1" d="M12 20h9" />, <path key="2" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />],
    rename: [<path key="1" d="M4 7h16" />, <path key="2" d="M10 7v10" />, <path key="3" d="M14 7v10" />, <path key="4" d="M8 17h8" />],
    cancel: [<path key="1" d="M18 6L6 18" />, <path key="2" d="M6 6l12 12" />],
    save: [<path key="1" d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />, <polyline key="2" points="17 21 17 13 7 13 7 21" />],
    close: [<path key="1" d="M18 6L6 18" />, <path key="2" d="M6 6l12 12" />],
  };

  return <svg {...common} aria-hidden>{paths[name] || null}</svg>;
}

function FileserverApp() {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');
  const [dragActive, setDragActive] = useState(false);
  const [draggingPaths, setDraggingPaths] = useState([]);
  const [dropTargetPath, setDropTargetPath] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewState, setPreviewState] = useState({ open: false, kind: null, path: '', content: '', error: '', objectUrl: '', editable: false });
  const filePickerRef = useRef(null);

  const breadcrumb = useMemo(() => splitSegments(currentPath), [currentPath]);
  const parentPath = useMemo(() => (
    breadcrumb.length ? breadcrumb[breadcrumb.length - 2]?.path || '' : null
  ), [breadcrumb]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const safeItems = Array.isArray(items) ? items : [];
    return safeItems
      .filter((item) => !q || item.name.toLowerCase().includes(q))
      .sort((a, b) => compareItems(a, b, sortBy));
  }, [items, query, sortBy]);
  const listedItems = useMemo(() => (
    currentPath
      ? [{
          name: '..',
          relativePath: '__up__',
          targetPath: parentPath || '',
          type: 'directory',
          size: 0,
          updatedAt: '',
          isUpEntry: true,
        }, ...filteredItems]
      : filteredItems
  ), [currentPath, filteredItems, parentPath]);

  const selectedItem = useMemo(() => items.find((item) => item.relativePath === selected) || null, [items, selected]);
  const visiblePaths = useMemo(() => filteredItems.map((item) => item.relativePath), [filteredItems]);
  const allVisibleSelected = visiblePaths.length > 0 && visiblePaths.every((p) => selectedPaths.includes(p));

  useEffect(() => () => {
    if (previewState.objectUrl) {
      URL.revokeObjectURL(previewState.objectUrl);
    }
  }, [previewState.objectUrl]);

  async function refresh(path = currentPath) {
    setLoading(true);
    setError('');
    try {
      const data = await listDirectory(path);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setCurrentPath(typeof data?.currentPath === 'string' ? data.currentPath : '');
      setSelected(null);
      setSelectedPaths([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh('');
  }, []);

  function toggleSelectedPath(relativePath) {
    setSelectedPaths((prev) => (prev.includes(relativePath) ? prev.filter((p) => p !== relativePath) : [...prev, relativePath]));
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedPaths((prev) => prev.filter((p) => !visiblePaths.includes(p)));
      return;
    }
    setSelectedPaths((prev) => [...new Set([...prev, ...visiblePaths])]);
  }

  function getDraggedPaths(itemPath) {
    return selectedPaths.includes(itemPath) ? selectedPaths : [itemPath];
  }

  async function openFilePreview(item) {
    const kind = detectPreviewKind(item);
    if (!kind) {
      setError('Anteprima non supportata per questo file');
      return;
    }

    if (previewState.objectUrl) {
      URL.revokeObjectURL(previewState.objectUrl);
    }

    if (kind === 'text') {
      try {
        const data = await loadFileContent(item.relativePath);
        const extension = getFileExtension(item.name);
        const editable = INLINE_EDITABLE_EXTENSIONS.has(extension);
        setPreviewState({ open: true, kind, path: item.relativePath, content: data.content, error: '', objectUrl: '', editable });
      } catch (err) {
        setPreviewState({ open: true, kind, path: item.relativePath, content: '', error: err.message, objectUrl: '', editable: false });
      }
      return;
    }

    try {
      const { blob } = await loadRawFileBlob(item.relativePath);
      const objectUrl = URL.createObjectURL(blob);
      setPreviewState({ open: true, kind, path: item.relativePath, content: '', error: '', objectUrl, editable: false });
    } catch (err) {
      setPreviewState({ open: true, kind, path: item.relativePath, content: '', error: err.message, objectUrl: '', editable: false });
    }
  }

  function closePreview() {
    if (previewState.objectUrl) {
      URL.revokeObjectURL(previewState.objectUrl);
    }
    setPreviewState({ open: false, kind: null, path: '', content: '', error: '', objectUrl: '', editable: false });
  }

  async function handleFileDownload(item) {
    try {
      setError('');
      const { blob, filename } = await downloadFile(item.relativePath);
      triggerBlobDownload(blob, filename);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleOpen(item) {
    if (item.isUpEntry) {
      await refresh(item.targetPath || '');
      return;
    }

    if (item.type === 'directory') {
      await refresh(item.relativePath);
      return;
    }

    setSelected(item.relativePath);
    await openFilePreview(item);
  }

  async function handleUploadFromList(files) {
    if (!files?.length) return;

    try {
      setError('');
      setUploadProgress(0);
      await uploadFiles(currentPath, files, (progress) => setUploadProgress(progress));
      setUploadProgress(100);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setTimeout(() => setUploadProgress(null), 500);
    }
  }

  async function handleUpload(event) {
    const files = event.target.files;
    await handleUploadFromList(files);
    event.target.value = '';
  }

  async function handleDelete(item) {
    if (!window.confirm(`Eliminare ${item.name}?`)) return;
    try {
      setError('');
      await deleteItem(item.relativePath);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteSelected() {
    if (selectedPaths.length === 0) return;
    if (!window.confirm(`Eliminare ${selectedPaths.length} elementi selezionati?`)) return;

    try {
      setError('');
      await Promise.all(selectedPaths.map((itemPath) => deleteItem(itemPath)));
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownloadSelectedZip() {
    if (selectedPaths.length === 0) return;

    try {
      setError('');
      const { blob, filename } = await createArchive(selectedPaths, `selection-${Date.now()}.zip`);
      triggerBlobDownload(blob, filename);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownloadDirectoryZip(item) {
    try {
      setError('');
      const { blob, filename } = await createArchive([item.relativePath], `${item.name}.zip`);
      triggerBlobDownload(blob, filename);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRename(item) {
    const nextName = window.prompt('Nuovo nome', item.name);
    if (!nextName || nextName === item.name) return;

    try {
      setError('');
      await renameItem(item.relativePath, nextName.trim());
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateFolder() {
    const name = window.prompt('Nome cartella');
    if (!name) return;

    try {
      setError('');
      await createFolder(currentPath, name.trim());
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveInlinePreview() {
    if (!previewState.path || !previewState.editable) return;
    try {
      setError('');
      setPreviewSaving(true);
      await saveFileContent(previewState.path, previewState.content);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewSaving(false);
    }
  }

  async function handleMove(targetPath, paths) {
    if (!targetPath || !paths.length) return;

    try {
      setError('');
      await moveItems(paths, targetPath);
      setSelected(targetPath);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message);
    } finally {
      setDraggingPaths([]);
      setDropTargetPath('');
    }
  }

  function stopRowClick(event) {
    event.stopPropagation();
  }

  function onDragOver(event) {
    if (draggingPaths.length > 0) {
      event.preventDefault();
      return;
    }
    if (!hasFilesInDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    if (!dragActive) setDragActive(true);
  }

  function onDragLeave(event) {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragActive(false);
  }

  async function onDrop(event) {
    if (draggingPaths.length > 0) {
      event.preventDefault();
      setDropTargetPath('');
      return;
    }
    if (!hasFilesInDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer?.files;
    await handleUploadFromList(files);
  }

  function handleRowDragStart(event, item) {
    if (item.isUpEntry) {
      event.preventDefault();
      return;
    }

    if (isInteractiveElement(event.target)) {
      event.preventDefault();
      return;
    }

    const nextPaths = getDraggedPaths(item.relativePath);
    setDraggingPaths(nextPaths);
    setSelected(item.relativePath);
    if (!selectedPaths.includes(item.relativePath)) {
      setSelectedPaths(nextPaths);
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', nextPaths.join('\n'));
    }
  }

  function handleRowDragEnd() {
    setDraggingPaths([]);
    setDropTargetPath('');
  }

  function handleFolderDragOver(event, item) {
    if (!draggingPaths.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const nextTargetPath = item.isUpEntry ? (item.targetPath || '') : item.relativePath;
    if (dropTargetPath !== nextTargetPath) {
      setDropTargetPath(nextTargetPath);
    }
  }

  function handleFolderDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropTargetPath('');
  }

  async function handleFolderDrop(event, item) {
    if (!draggingPaths.length) return;
    event.preventDefault();
    event.stopPropagation();
    await handleMove(item.isUpEntry ? (item.targetPath || '') : item.relativePath, draggingPaths);
  }

  return (
    <div className="desktop">
      <header className="topbar">
        <div className="window-controls" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <h1>File Explorer</h1>
      </header>

      <section className="toolbar">
        <button className="icon-btn" onClick={() => refresh(currentPath)} disabled={loading} title="Aggiorna" aria-label="Aggiorna"><Icon name="refresh" /></button>
        <button className="icon-btn" onClick={() => refresh('')} disabled={loading} title="Root" aria-label="Root"><Icon name="home" /></button>
        <button className="icon-btn" onClick={() => refresh(breadcrumb.length ? breadcrumb[breadcrumb.length - 2]?.path || '' : '')} disabled={loading || !currentPath} title="Su" aria-label="Su"><Icon name="up" /></button>
        <button className="icon-btn" onClick={handleCreateFolder} title="Nuova cartella" aria-label="Nuova cartella"><Icon name="folderPlus" /></button>
        <button className="icon-btn" onClick={() => filePickerRef.current?.click()} title="Carica file" aria-label="Carica file"><Icon name="upload" /></button>
        <input ref={filePickerRef} type="file" multiple hidden onChange={handleUpload} />
        <input
          type="search"
          placeholder="Cerca file/cartelle"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="search-input"
        />
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="sort-select">
          <option value="name_asc">Nome A-Z</option>
          <option value="name_desc">Nome Z-A</option>
          <option value="date_desc">Data piu recente</option>
          <option value="date_asc">Data piu vecchia</option>
          <option value="size_desc">Dimensione decrescente</option>
          <option value="size_asc">Dimensione crescente</option>
        </select>
      </section>

      <section className="batchbar">
        <button className="icon-btn" onClick={toggleSelectAllVisible} title={allVisibleSelected ? 'Deseleziona visibili' : 'Seleziona visibili'} aria-label={allVisibleSelected ? 'Deseleziona visibili' : 'Seleziona visibili'}><Icon name="selectAll" /></button>
        <button className="icon-btn" onClick={() => setSelectedPaths([])} disabled={selectedPaths.length === 0} title="Azzera selezione" aria-label="Azzera selezione"><Icon name="clear" /></button>
        <button className="icon-btn" onClick={handleDownloadSelectedZip} disabled={selectedPaths.length === 0} title="Scarica selezione ZIP" aria-label="Scarica selezione ZIP"><Icon name="zip" /></button>
        <button className="icon-btn danger" onClick={handleDeleteSelected} disabled={selectedPaths.length === 0} title="Elimina selezione" aria-label="Elimina selezione"><Icon name="trash" /></button>
        <span className="batch-count">Selezionati: {selectedPaths.length}</span>
        {uploadProgress !== null && (
          <div className="upload-progress" aria-label="upload progress">
            <div style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
      </section>

      <nav className="breadcrumbs">
        <button onClick={() => refresh('')}>/</button>
        {breadcrumb.map((segment) => (
          <button key={segment.path} onClick={() => refresh(segment.path)}>{segment.name}</button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}

      <main className="pane">
        <aside className="sidebar">
          <h2>Posizione</h2>
          <p>{currentPath || '/'}</p>
          <h2>Elemento attivo</h2>
          <p>{selected || 'Nessuno'}</p>
          <h2>Elementi visibili</h2>
          <p>{filteredItems.length}</p>
          <h2>Anteprima rapida</h2>
          {!selectedItem && <p>Seleziona un file.</p>}
          {selectedItem?.type === 'directory' && <p>Cartella selezionata.</p>}
          {selectedItem?.type === 'file' && (
            <button className="icon-btn" onClick={() => openFilePreview(selectedItem)} title="Apri anteprima" aria-label="Apri anteprima"><Icon name="eye" /></button>
          )}
        </aside>

        <section
          className={`content ${dragActive ? 'drag-active' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="drop-hint">Trascina qui i file per caricarli</div>
          <table>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                </th>
                <th>Nome</th>
                <th>Dimensione</th>
                <th>Modificato</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {listedItems.map((item) => {
                const checked = !item.isUpEntry && selectedPaths.includes(item.relativePath);
                return (
                  <tr
                    key={item.relativePath}
                    draggable={!item.isUpEntry}
                    className={[
                      checked || selected === item.relativePath ? 'selected-row' : '',
                      item.type === 'directory' && dropTargetPath === (item.isUpEntry ? (item.targetPath || '') : item.relativePath) ? 'drop-target-row' : '',
                      draggingPaths.includes(item.relativePath) ? 'dragging-row' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelected(item.relativePath)}
                    onDoubleClick={() => handleOpen(item)}
                    onDragStart={(event) => handleRowDragStart(event, item)}
                    onDragEnd={handleRowDragEnd}
                    onDragOver={item.type === 'directory' ? (event) => handleFolderDragOver(event, item) : undefined}
                    onDragLeave={item.type === 'directory' ? handleFolderDragLeave : undefined}
                    onDrop={item.type === 'directory' ? (event) => handleFolderDrop(event, item) : undefined}
                  >
                    <td>
                      {item.isUpEntry ? null : (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            stopRowClick(event);
                            toggleSelectedPath(item.relativePath);
                          }}
                          onClick={stopRowClick}
                        />
                      )}
                    </td>
                    <td>
                      <span className={`icon icon-${item.type}`} aria-hidden />
                      <span>{item.name}</span>
                    </td>
                    <td>{item.type === 'directory' ? '-' : formatSize(item.size)}</td>
                    <td>{item.updatedAt ? formatDate(item.updatedAt) : '-'}</td>
                    <td>
                      {item.isUpEntry ? (
                        <button className="icon-btn" onClick={(event) => { stopRowClick(event); refresh(item.targetPath || ''); }} title="Su" aria-label="Su"><Icon name="up" /></button>
                      ) : item.type === 'directory' ? (
                        <>
                          <button className="icon-btn" onClick={(event) => { stopRowClick(event); refresh(item.relativePath); }} title="Apri" aria-label="Apri"><Icon name="open" /></button>
                          <button className="icon-btn" onClick={(event) => { stopRowClick(event); handleDownloadDirectoryZip(item); }} title="Scarica ZIP" aria-label="Scarica ZIP"><Icon name="zip" /></button>
                        </>
                      ) : (
                        <>
                          <button className="icon-btn" onClick={(event) => { stopRowClick(event); handleFileDownload(item); }} title="Scarica" aria-label="Scarica"><Icon name="download" /></button>
                          <button className="icon-btn" onClick={(event) => { stopRowClick(event); openFilePreview(item); }} title="Anteprima" aria-label="Anteprima"><Icon name="eye" /></button>
                          <button className="icon-btn" onClick={(event) => { stopRowClick(event); openFilePreview(item); }} title="Modifica in linea" aria-label="Modifica in linea"><Icon name="edit" /></button>
                        </>
                      )}
                      {!item.isUpEntry && <button className="icon-btn" onClick={(event) => { stopRowClick(event); handleRename(item); }} title="Rinomina" aria-label="Rinomina"><Icon name="rename" /></button>}
                      {!item.isUpEntry && <button className="icon-btn danger" onClick={(event) => { stopRowClick(event); handleDelete(item); }} title="Elimina" aria-label="Elimina"><Icon name="trash" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <p className="loading">Caricamento...</p>}
        </section>
      </main>

      {previewState.open && (
        <div className="modal-overlay" onClick={closePreview}>
          <div className="modal preview-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Anteprima: {previewState.path}</h3>
            {previewState.error && <p className="error-inline">{previewState.error}</p>}
            {!previewState.error && previewState.kind === 'image' && (
              <img src={previewState.objectUrl} alt={previewState.path} className="preview-image" />
            )}
            {!previewState.error && previewState.kind === 'pdf' && (
              <iframe src={previewState.objectUrl} title={previewState.path} className="preview-pdf" />
            )}
            {!previewState.error && previewState.kind === 'text' && (
              previewState.editable ? (
                <textarea
                  className="preview-inline-editor"
                  value={previewState.content}
                  onChange={(event) => setPreviewState((prev) => ({ ...prev, content: event.target.value }))}
                />
              ) : (
                <pre className="preview-text">{previewState.content}</pre>
              )
            )}
            <div className="modal-actions">
              {!previewState.error && previewState.kind === 'text' && previewState.editable && (
                <button className="icon-btn" onClick={handleSaveInlinePreview} title="Salva" aria-label="Salva" disabled={previewSaving}>
                  <Icon name="save" />
                </button>
              )}
              <button className="icon-btn" onClick={closePreview} title="Chiudi" aria-label="Chiudi"><Icon name="close" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const bundledWidgetRootRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let active = true;
    const mountTarget = bundledWidgetRootRef.current;

    window.__AUTH_WIDGET_CONFIG__ = {
      ...(window.__AUTH_WIDGET_CONFIG__ || {}),
      issuer: OAUTH_ISSUER,
      clientId: OAUTH_CLIENT_ID,
      origin: window.location.origin,
      redirectUri: OAUTH_REDIRECT_URI,
      postLogoutRedirectUri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPE,
    };

    if (mountTarget) {
      mountTarget.id = 'app';
    }

    function onProfileEvent(event) {
      if (!active) return;
      setProfile(event.detail?.profile || null);
      setAuthReady(true);
      setAuthError('');
    }

    window.addEventListener(OAUTH_EVENT_NAME, onProfileEvent);

    loadOAuthWidgetScript()
      .then(() => {
        if (!active) return;
        setAuthReady(true);
      })
      .catch((err) => {
        if (!active) return;
        setAuthError(err.message || 'Errore inizializzazione autenticazione');
        setAuthReady(true);
      });

    return () => {
      active = false;
      window.removeEventListener(OAUTH_EVENT_NAME, onProfileEvent);
      if (mountTarget?.id === 'app') {
        mountTarget.removeAttribute('id');
      }
    };
  }, []);

  return (
    <>
      <div ref={bundledWidgetRootRef} />
      {profile ? (
        <FileserverApp />
      ) : (
        <div className="auth-guard">
          <div className="auth-guard-card">
            <h1>Accesso richiesto</h1>
            {!authReady && <p>Verifica sessione OAuth in corso...</p>}
            {authReady && !authError && <p>Effettua login con il widget OAuth per vedere l&apos;applicazione.</p>}
            {authError && <p className="error">{authError}</p>}
          </div>
        </div>
      )}
    </>
  );
}
