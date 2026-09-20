import { useMemo, useRef, useState } from 'react';
import { formatFileSize, parentDirectory } from '../models';

export default function FileList({ currentPath, items, loading, error, onOpen, onRefresh, onUpload, onCreateDirectory, onDownload }) {
  const picker = useRef(null);
  const [query, setQuery] = useState('');
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => !normalized || item.name.toLowerCase().includes(normalized));
  }, [items, query]);

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await onUpload(file);
  }

  async function createDirectory() {
    const name = window.prompt('Nome cartella');
    if (name?.trim()) await onCreateDirectory(name.trim());
  }

  return (
    <>
      <section className="toolbar">
        <button type="button" onClick={onRefresh} disabled={loading}>Aggiorna</button>
        <button type="button" onClick={() => onOpen('')} disabled={!currentPath || loading}>Root</button>
        <button type="button" onClick={() => onOpen(parentDirectory(currentPath))} disabled={!currentPath || loading}>Su</button>
        <button type="button" onClick={createDirectory}>Nuova cartella</button>
        <button type="button" onClick={() => picker.current?.click()}>Carica file</button>
        <input ref={picker} type="file" hidden onChange={chooseFile} />
        <input className="search-input" type="search" placeholder="Filtra la lista" value={query} onChange={(event) => setQuery(event.target.value)} />
      </section>
      <nav className="breadcrumbs"><strong>VFS2:</strong> /{currentPath}</nav>
      {error && <p className="error">{error}</p>}
      <main className="content vfs-list">
        <table>
          <thead><tr><th>Nome</th><th>Tipo</th><th>Dimensione</th><th>Modificato</th><th>Azioni</th></tr></thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.path}>
                <td><span className={`icon icon-${item.type}`} aria-hidden /> {item.name}</td>
                <td>{item.type === 'directory' ? 'Cartella' : 'File'}</td>
                <td>{item.type === 'file' ? formatFileSize(item.size) : '—'}</td>
                <td>{item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}</td>
                <td>{item.type === 'directory'
                  ? <button type="button" onClick={() => onOpen(item.path)}>Apri</button>
                  : <button type="button" onClick={() => onDownload(item)}>Scarica</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="loading">Caricamento lista da VFS2…</p>}
        {!loading && visibleItems.length === 0 && <p className="empty-list">Nessun file presente in questa directory.</p>}
      </main>
    </>
  );
}
