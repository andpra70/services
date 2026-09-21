import { useMemo, useRef, useState } from 'react';
import { formatFileSize, parentDirectory } from '../models';
import GlyphButton from './GlyphButton';
import VolumeBreadcrumbs from './VolumeBreadcrumbs';

export default function FileList({ volume, currentPath, items, loading, uploading, operationPath, error, onVolumeChange, onOpen, onRefresh, onUpload, onCreateDirectory, onDownload, onPreview, onDelete, onRename }) {
  const picker = useRef(null);
  const [query, setQuery] = useState('');
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;
  const readOnly = volume === 'public';
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => !normalized || item.name.toLowerCase().includes(normalized));
  }, [items, query]);

  async function chooseFile(event) {
    const files = event.target.files;
    event.target.value = '';
    if (files?.length) await onUpload(files);
  }

  function handleDragEnter(event) {
    event.preventDefault();
    if (!readOnly && event.dataTransfer?.types?.includes('Files')) setDragDepth((depth) => depth + 1);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setDragDepth((depth) => Math.max(0, depth - 1));
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  async function handleDrop(event) {
    event.preventDefault();
    setDragDepth(0);
    const files = event.dataTransfer?.files;
    if (!readOnly && files?.length) await onUpload(files);
  }

  async function createDirectory() {
    const name = window.prompt('Nome cartella');
    if (name?.trim()) await onCreateDirectory(name.trim());
  }

  return (
    <>
      <section className="toolbar">
        <GlyphButton glyph="↻" label="Aggiorna" onClick={onRefresh} disabled={loading} />
        <GlyphButton glyph="⌂" label="Vai alla root" onClick={() => onOpen('')} disabled={!currentPath || loading} />
        <GlyphButton glyph="↑" label="Directory superiore" onClick={() => onOpen(parentDirectory(currentPath))} disabled={!currentPath || loading} />
        {!readOnly && <GlyphButton glyph="⊞" label="Nuova cartella" onClick={createDirectory} />}
        {!readOnly && <GlyphButton glyph={uploading ? '…' : '⇧'} label={uploading ? 'Caricamento in corso' : 'Carica file'} onClick={() => picker.current?.click()} disabled={uploading} />}
        <input ref={picker} type="file" multiple hidden onChange={chooseFile} />
        <input className="search-input" type="search" placeholder="Filtra la lista" value={query} onChange={(event) => setQuery(event.target.value)} />
      </section>
      <VolumeBreadcrumbs volume={volume} path={currentPath} disabled={loading} onVolumeChange={onVolumeChange} onOpen={onOpen} />
      {error && <p className="error">{error}</p>}
      <main
        className={`content vfs-list${dragActive ? ' drag-active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="drop-hint" aria-hidden={!dragActive}>
          Rilascia i file in /{currentPath || ''}
        </div>
        <table>
          <thead><tr><th>Nome</th><th>Tipo</th><th>Dimensione</th><th>Modificato</th><th>Azioni</th></tr></thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.path}>
                <td>
                  <button
                    type="button"
                    className="file-name-button"
                    onClick={() => item.type === 'directory' ? onOpen(item.path) : onPreview(item)}
                    title={item.type === 'directory' ? 'Apri cartella' : 'Apri anteprima'}
                  >
                    <span className={`icon icon-${item.type}`} aria-hidden /> {item.name}
                  </button>
                </td>
                <td>{item.type === 'directory' ? 'Cartella' : 'File'}</td>
                <td>{item.type === 'file' ? formatFileSize(item.size) : '—'}</td>
                <td>{item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}</td>
                <td>
                  <span className="row-actions">
                    {item.type === 'directory'
                      ? <GlyphButton glyph="↳" label={`Apri ${item.name}`} onClick={() => onOpen(item.path)} disabled={operationPath === item.path} />
                      : <>
                        <GlyphButton glyph="◉" label={`Anteprima ${item.name}`} onClick={() => onPreview(item)} disabled={operationPath === item.path} />
                        <GlyphButton glyph="⇩" label={`Scarica ${item.name}`} onClick={() => onDownload(item)} disabled={operationPath === item.path} />
                      </>}
                    {!readOnly && <GlyphButton glyph="✎" label={`Rinomina ${item.name}`} onClick={() => onRename(item)} disabled={operationPath === item.path} />}
                    {!readOnly && <GlyphButton glyph={operationPath === item.path ? '…' : '×'} label={operationPath === item.path ? `Operazione in corso su ${item.name}` : `Elimina ${item.name}`} className="danger" onClick={() => onDelete(item)} disabled={operationPath === item.path} />}
                  </span>
                </td>
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
