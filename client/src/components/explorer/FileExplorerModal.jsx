import { useEffect, useMemo, useRef, useState } from 'react';

const parentPath = (path) => String(path || '').split('/').filter(Boolean).slice(0, -1).join('/');
const formatSize = (bytes) => !bytes ? '—' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export default function FileExplorerModal({ initialPath, initialVolume, options, volumes, onResolve }) {
  const [volume, setVolume] = useState(initialVolume);
  const [path, setPath] = useState(initialPath);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(initialVolume ? [{ volume: initialVolume, path: initialPath }] : []);
  const [historyIndex, setHistoryIndex] = useState(initialVolume ? 0 : -1);
  const [saveName, setSaveName] = useState(options.suggestedName || '');
  const dialogRef = useRef(null);

  const load = async (nextVolume, nextPath, addHistory = true) => {
    if (!nextVolume) { setVolume(null); setPath(''); setItems([]); setSelected(null); return; }
    if (!volumes[nextVolume].available()) {
      setVolume(nextVolume); setError('Accesso richiesto per il volume privato.'); setItems([]); return;
    }
    setLoading(true); setError(''); setSelected(null);
    try {
      const listing = await volumes[nextVolume].list(nextPath);
      setVolume(nextVolume); setPath(listing.path); setItems(listing.items);
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
  const confirm = () => {
    if (options.mode === 'directory') return onResolve({ volume, type: 'directory', name: path.split('/').pop() || volume, path });
    if (options.mode === 'save') {
      const name = saveName.trim();
      if (!name || volume !== 'private') return;
      const targetPath = path ? `${path}/${name}` : name;
      return onResolve({ volume, type: 'file', name, path: targetPath, exists: items.some((item) => item.name === name) });
    }
    if (selected?.type === 'file') onResolve({ ...selected, url: volume === 'public' ? `/vfs/public/${selected.path}` : null });
  };

  return <div className="vfs-overlay" onMouseDown={(event) => event.target === event.currentTarget && onResolve(null)}>
    <section className="vfs-dialog" role="dialog" aria-modal="true" aria-label="VFS File Explorer" tabIndex={-1} ref={dialogRef}>
      <header className="vfs-titlebar"><strong>File Explorer</strong><button onClick={() => onResolve(null)} aria-label="Chiudi">×</button></header>
      <div className="vfs-toolbar">
        <button disabled={historyIndex <= 0} onClick={() => { const target = history[historyIndex - 1]; setHistoryIndex(historyIndex - 1); load(target.volume, target.path, false); }}>←</button>
        <button disabled={historyIndex >= history.length - 1} onClick={() => { const target = history[historyIndex + 1]; setHistoryIndex(historyIndex + 1); load(target.volume, target.path, false); }}>→</button>
        <button disabled={!volume || !path} onClick={() => load(volume, parentPath(path))}>↑</button>
        <button disabled={!volume} onClick={() => load(volume, path, false)}>↻</button>
        <div className="vfs-crumbs">{volume ? <><button onClick={() => load(null, '')}>Computer</button><span>/</span><button onClick={() => load(volume, '')}>{volume === 'private' ? 'Privato' : 'Pubblico'}</button>{path.split('/').filter(Boolean).map((part, index, all) => <span key={`${part}-${index}`}> / <button onClick={() => load(volume, all.slice(0, index + 1).join('/'))}>{part}</button></span>)}</> : <strong>Computer</strong>}</div>
        <input type="search" placeholder="Cerca" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="vfs-main">
        <aside><button className={!volume ? 'active' : ''} onClick={() => load(null, '')}>🖥 Computer</button>{volumes.private.available() && <button className={volume === 'private' ? 'active' : ''} onClick={() => load('private', '')}>🔒 Privato</button>}<button className={volume === 'public' ? 'active' : ''} onClick={() => load('public', '')}>🌐 Pubblico</button></aside>
        <main>
          {!volume ? <div className="vfs-volumes">{volumes.private.available() && <button onDoubleClick={() => load('private', '')} onClick={() => setSelected({ volume: 'private' })}>🔒<strong>Privato</strong></button>}<button onDoubleClick={() => load('public', '')} onClick={() => setSelected({ volume: 'public' })}>🌐<strong>Pubblico</strong></button></div> : <table><thead><tr><th>Nome</th><th>Tipo</th><th>Dimensione</th><th>Modificato</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.path} className={selected?.path === item.path ? 'selected' : ''} onClick={() => setSelected(item)} onDoubleClick={() => item.type === 'directory' ? navigate(item) : options.mode === 'file' && onResolve({ ...item, url: volume === 'public' ? `/vfs/public/${item.path}` : null })}><td>{item.type === 'directory' ? '📁' : '📄'} {item.name}</td><td>{item.type === 'directory' ? 'Cartella' : 'File'}</td><td>{formatSize(item.size)}</td><td>{item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}</td></tr>)}</tbody></table>}
          {loading && <p className="vfs-status">Caricamento…</p>}{error && <p className="vfs-error">{error}</p>}{volume && !loading && !error && !visibleItems.length && <p className="vfs-status">Directory vuota</p>}
        </main>
      </div>
      <footer>{options.mode === 'save' && <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Nome file" />}<span>{selected?.path || (volume ? `${volume}:/${path}` : '')}</span><button onClick={() => onResolve(null)}>Annulla</button><button className="primary" disabled={!volume || (options.mode === 'file' && selected?.type !== 'file') || (options.mode === 'save' && (!saveName.trim() || volume !== 'private'))} onClick={confirm}>{options.mode === 'save' ? 'Salva qui' : options.mode === 'directory' ? 'Seleziona cartella' : 'Apri'}</button></footer>
    </section>
  </div>;
}
