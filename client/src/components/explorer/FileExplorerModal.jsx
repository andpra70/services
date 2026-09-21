import { useEffect, useMemo, useRef, useState } from 'react';

const parentPath = (path) => String(path || '').split('/').filter(Boolean).slice(0, -1).join('/');
const formatSize = (bytes) => !bytes ? '—' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export default function FileExplorerModal({ initialPath, initialVolume, options, volumes, onLocationChange, onResolve }) {
  const [volume, setVolume] = useState(initialVolume);
  const [path, setPath] = useState(initialPath);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(initialVolume ? [{ volume: initialVolume, path: initialPath }] : []);
  const [historyIndex, setHistoryIndex] = useState(initialVolume ? 0 : -1);
  const [saveName, setSaveName] = useState(options.suggestedName || '');
  const dialogRef = useRef(null);
  const filePickerRef = useRef(null);

  const load = async (nextVolume, nextPath, addHistory = true) => {
    if (!nextVolume) { setVolume(null); setPath(''); setItems([]); setSelected(null); return; }
    if (!volumes[nextVolume].available()) {
      setVolume(nextVolume); setError('Accesso richiesto per il volume privato.'); setItems([]); return;
    }
    setLoading(true); setError(''); setSelected(null);
    try {
      const listing = await volumes[nextVolume].list(nextPath);
      setVolume(nextVolume); setPath(listing.path); setItems(listing.items);
      onLocationChange({ volume: nextVolume, path: listing.path });
      if (addHistory) {
        const next = [...history.slice(0, historyIndex + 1), { volume: nextVolume, path: listing.path }];
        setHistory(next); setHistoryIndex(next.length - 1);
      }
    } catch (reason) { setError(reason?.message || 'Impossibile leggere la directory'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (initialVolume) load(initialVolume, initialPath, false); }, []);
  useEffect(() => {
    dialogRef.current?.focus();
    const keydown = (event) => { if (event.key === 'Escape') onResolve(null); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const accept = Array.isArray(options.accept) ? options.accept : [];
    return items.filter((item) => {
      if (needle && !item.name.toLowerCase().includes(needle)) return false;
      if (item.type === 'directory' || !accept.length) return true;
      return accept.some((rule) => rule === '*/*' || (rule.startsWith('.') && item.name.toLowerCase().endsWith(rule.toLowerCase())));
    }).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
  }, [items, query, options.accept]);

  const navigate = (item) => item.type === 'directory' ? load(volume, item.path) : setSelected(item);
  const canUpload = Boolean(volume && volumes[volume]?.writable && !loading && !uploading);

  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (canUpload && event.dataTransfer?.types?.includes('Files')) setDragDepth((depth) => depth + 1);
  };
  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((depth) => Math.max(0, depth - 1));
  };
  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = canUpload ? 'copy' : 'none';
  };
  const handleDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragDepth(0);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!canUpload || !files.length) return;
    setUploading(true); setError('');
    try {
      for (const file of files) await volumes[volume].upload(path, file);
      await load(volume, path, false);
    } catch (reason) {
      setError(reason?.message || 'Caricamento non riuscito');
    } finally {
      setUploading(false);
    }
  };
  const chooseFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!canUpload || !files.length) return;
    setUploading(true); setError('');
    try { for (const file of files) await volumes[volume].upload(path, file); await load(volume, path, false); }
    catch (reason) { setError(reason?.message || 'Caricamento non riuscito'); }
    finally { setUploading(false); }
  };
  const createDirectory = async () => {
    const name = window.prompt('Nome cartella')?.trim();
    if (!name || !canUpload) return;
    try { await volumes[volume].mkdir(path ? `${path}/${name}` : name); await load(volume, path, false); }
    catch (reason) { setError(reason?.message || 'Creazione cartella non riuscita'); }
  };
  const renameItem = async (item) => {
    const name = window.prompt(`Nuovo nome per “${item.name}”`, item.name)?.trim();
    if (!name || name === item.name) return;
    const parent = parentPath(item.path);
    try { await volumes[volume].rename(item.path, parent ? `${parent}/${name}` : name, item.type); await load(volume, path, false); }
    catch (reason) { setError(reason?.message || 'Rinomina non riuscita'); }
  };
  const removeItem = async (item) => {
    if (!window.confirm(`Eliminare “${item.name}”${item.type === 'directory' ? ' e tutto il suo contenuto' : ''}?`)) return;
    try { await volumes[volume].remove(item); await load(volume, path, false); }
    catch (reason) { setError(reason?.message || 'Eliminazione non riuscita'); }
  };
  const downloadItem = async (item) => {
    try {
      const response = await volumes[volume].fetch(item.path);
      if (!response.ok) throw new Error(`Download non riuscito (${response.status})`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = objectUrl; link.download = item.name;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
    } catch (reason) { setError(reason?.message || 'Download non riuscito'); }
  };
  const confirm = () => {
    if (options.mode === 'directory') return onResolve({ volume, type: 'directory', name: path.split('/').pop() || volume, path });
    if (options.mode === 'save') {
      const name = saveName.trim();
      if (!name || volume !== 'private') return;
      const targetPath = path ? `${path}/${name}` : name;
      return onResolve({ volume, type: 'file', name, path: targetPath, exists: items.some((item) => item.name === name) });
    }
    if (selected?.type === 'file') onResolve(selected);
  };

  return <div className="vfs-overlay" onMouseDown={(event) => event.target === event.currentTarget && onResolve(null)}>
    <section className="vfs-dialog" role="dialog" aria-modal="true" aria-label="VFS File Explorer" tabIndex={-1} ref={dialogRef}>
      <header className="vfs-titlebar"><strong>File Explorer</strong><button onClick={() => onResolve(null)} aria-label="Chiudi">×</button></header>
      <div className="vfs-toolbar">
        <button disabled={historyIndex <= 0} onClick={() => { const target = history[historyIndex - 1]; setHistoryIndex(historyIndex - 1); load(target.volume, target.path, false); }}>←</button>
        <button disabled={historyIndex >= history.length - 1} onClick={() => { const target = history[historyIndex + 1]; setHistoryIndex(historyIndex + 1); load(target.volume, target.path, false); }}>→</button>
        <button disabled={!volume || !path} onClick={() => load(volume, parentPath(path))}>↑</button>
        <button disabled={!volume} onClick={() => load(volume, path, false)}>↻</button>
        {canUpload && <><button className="vfs-glyph" title="Nuova cartella" aria-label="Nuova cartella" onClick={createDirectory}>⊞</button><button className="vfs-glyph" title="Carica file" aria-label="Carica file" onClick={() => filePickerRef.current?.click()}>⇧</button><input ref={filePickerRef} type="file" multiple hidden onChange={(event) => { chooseFiles(event.target.files); event.target.value = ''; }} /></>}
        <div className="vfs-crumbs">{volume ? <><button onClick={() => load(null, '')}>Computer</button><span>/</span><button onClick={() => load(volume, '')}>{volume === 'private' ? 'Privato' : 'Pubblico'}</button>{path.split('/').filter(Boolean).map((part, index, all) => <span key={`${part}-${index}`}> / <button onClick={() => load(volume, all.slice(0, index + 1).join('/'))}>{part}</button></span>)}</> : <strong>Computer</strong>}</div>
        <input type="search" placeholder="Cerca" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className={`vfs-main${dragDepth > 0 ? ' drag-active' : ''}`} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
        <aside><button className={!volume ? 'active' : ''} onClick={() => load(null, '')}>🖥 Computer</button>{volumes.private.available() && <button className={volume === 'private' ? 'active' : ''} onClick={() => load('private', '')}>🔒 Privato</button>}<button className={volume === 'public' ? 'active' : ''} onClick={() => load('public', '')}>🌐 Pubblico</button></aside>
        <main>
          {dragDepth > 0 && canUpload && <div className="vfs-drop-hint">Rilascia qui per caricare in {path ? `/${path}` : '/'} </div>}
          {!volume ? <div className="vfs-volumes">{volumes.private.available() && <button onClick={() => load('private', '')}>🔒<strong>Privato</strong></button>}<button onClick={() => load('public', '')}>🌐<strong>Pubblico</strong></button></div> : <table><thead><tr><th>Nome</th><th>Tipo</th><th>Dimensione</th><th>Modificato</th><th>Azioni</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.path} className={selected?.path === item.path ? 'selected' : ''} onClick={() => setSelected(item)} onDoubleClick={() => item.type === 'directory' ? navigate(item) : options.mode === 'file' && onResolve(item)}><td>{item.type === 'directory' ? '📁' : '📄'} {item.name}</td><td>{item.type === 'directory' ? 'Cartella' : 'File'}</td><td>{formatSize(item.size)}</td><td>{item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}</td><td><span className="vfs-actions">{item.type === 'directory' ? <button title="Apri" aria-label={`Apri ${item.name}`} onClick={(event) => { event.stopPropagation(); navigate(item); }}>↳</button> : <button title="Scarica" aria-label={`Scarica ${item.name}`} onClick={(event) => { event.stopPropagation(); downloadItem(item); }}>⇩</button>}{volumes[volume]?.writable && <><button title="Rinomina" aria-label={`Rinomina ${item.name}`} onClick={(event) => { event.stopPropagation(); renameItem(item); }}>✎</button><button className="danger" title="Elimina" aria-label={`Elimina ${item.name}`} onClick={(event) => { event.stopPropagation(); removeItem(item); }}>×</button></>}</span></td></tr>)}</tbody></table>}
          {(loading || uploading) && <p className="vfs-status">{uploading ? 'Caricamento file…' : 'Caricamento…'}</p>}{error && <p className="vfs-error">{error}</p>}{volume && !loading && !uploading && !error && !visibleItems.length && <p className="vfs-status">Directory vuota</p>}
        </main>
      </div>
      <footer>{options.mode === 'save' && <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Nome file" />}<span>{selected?.path || (volume ? `${volume}:/${path}` : '')}</span><button onClick={() => onResolve(null)}>Annulla</button><button className="primary" disabled={!volume || (options.mode === 'file' && selected?.type !== 'file') || (options.mode === 'save' && (!saveName.trim() || volume !== 'private'))} onClick={confirm}>{options.mode === 'save' ? 'Salva qui' : options.mode === 'directory' ? 'Seleziona cartella' : 'Apri'}</button></footer>
    </section>
  </div>;
}
