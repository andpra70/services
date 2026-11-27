import { useCallback, useMemo, useRef, useState } from 'react';
import { formatFileSize, isImagePreviewEntry, isTextPreviewEntry, parentDirectory } from '../models';
import GlyphButton from './GlyphButton';
import VolumeBreadcrumbs from './VolumeBreadcrumbs';
import ContextMenu from './ContextMenu';
import ImageThumbnail from './ImageThumbnail';

export default function FileList({ volume, currentPath, items, loading, uploading, operationPath, error, onVolumeChange, onOpen, onRefresh, onUpload, onCreateDirectory, onDownload, onPreview, onLoadThumbnail, onEdit, onMove, onDelete, onRename }) {
  const picker = useRef(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
  const [dragDepth, setDragDepth] = useState(0);
  const [contextMenu, setContextMenu] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dropTarget, setDropTarget] = useState('');
  const [view, setView] = useState('list');
  const dragActive = dragDepth > 0;
  const readOnly = volume === 'public';
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const direction = sort.direction === 'asc' ? 1 : -1;
    const sorted = items.filter((item) => !normalized || item.name.toLowerCase().includes(normalized)).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      let compared;
      if (sort.key === 'size') compared = Number(a.size || 0) - Number(b.size || 0);
      else if (sort.key === 'lastModified') compared = Number(a.lastModified || 0) - Number(b.lastModified || 0);
      else compared = String(a[sort.key] || '').localeCompare(String(b[sort.key] || ''), undefined, { numeric: true, sensitivity: 'base' });
      return compared * direction || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    return [
      { name: '..', path: parentDirectory(currentPath), type: 'directory', virtual: true, virtualKind: 'parent' },
      ...sorted,
    ];
  }, [items, query, sort, currentPath]);

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  }

  const SortHeader = ({ field, children }) => <button type="button" className="sort-header" onClick={() => toggleSort(field)} aria-sort={sort.key === field ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>{children}<span aria-hidden>{sort.key === field ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}</span></button>;

  async function chooseFile(event) {
    const files = event.target.files;
    event.target.value = '';
    if (files?.length) await onUpload(files);
  }

  function handleDragEnter(event) {
    event.preventDefault();
    if (draggedItem) return;
    if (!readOnly && event.dataTransfer?.types?.includes('Files')) setDragDepth((depth) => depth + 1);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    if (!draggedItem) setDragDepth((depth) => Math.max(0, depth - 1));
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = draggedItem ? 'move' : 'copy';
  }

  async function handleDrop(event) {
    event.preventDefault();
    setDragDepth(0);
    if (draggedItem) {
      setDropTarget('');
      const item = draggedItem; setDraggedItem(null);
      await onMove(item, currentPath);
      return;
    }
    const files = event.dataTransfer?.files;
    if (!readOnly && files?.length) await onUpload(files);
  }

  function startItemDrag(event, item) {
    setDraggedItem(item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-vfs-item', item.path);
    event.dataTransfer.setData('text/plain', item.name);
  }

  async function dropOnDirectory(event, directory) {
    if (!draggedItem) return;
    event.preventDefault(); event.stopPropagation();
    const item = draggedItem;
    setDraggedItem(null); setDropTarget('');
    await onMove(item, directory.path);
  }

  async function createDirectory() {
    const name = window.prompt('Nome cartella');
    if (name?.trim()) await onCreateDirectory(name.trim());
  }

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  function openContextMenu(event, item = null) {
    event.preventDefault();
    event.stopPropagation();
    const busy = item && operationPath === item.path;
    const actions = item
      ? [
          item.type === 'directory'
            ? { id: 'open', icon: '↳', label: 'Apri', disabled: busy, run: () => onOpen(item.path) }
            : { id: 'preview', icon: '◉', label: 'Anteprima', disabled: busy, run: () => onPreview(item) },
          ...(!readOnly && item.type === 'file' && isTextPreviewEntry(item) ? [{ id: 'edit', icon: '✎', label: 'Modifica', disabled: busy, run: () => onEdit(item) }] : []),
          ...(item.type === 'file' ? [{ id: 'download', icon: '⇩', label: 'Scarica', disabled: busy, run: () => onDownload(item) }] : []),
          ...(!readOnly && !item.virtual ? [{ id: 'separator', separator: true }, { id: 'delete', icon: '×', label: 'Elimina', danger: true, disabled: busy, run: () => onDelete(item) }] : []),
        ]
      : (!readOnly ? [{ id: 'create-folder', icon: '⊞', label: 'Crea cartella', run: createDirectory }] : []);
    if (actions.length) setContextMenu({ x: event.clientX, y: event.clientY, actions });
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
        <span className="view-switch" aria-label="Tipo di vista">
          <button type="button" className={view === 'list' ? 'active' : ''} title="Vista elenco" aria-label="Vista elenco" onClick={() => setView('list')}>☷</button>
          <button type="button" className={view === 'grid' ? 'active' : ''} title="Vista griglia" aria-label="Vista griglia" onClick={() => setView('grid')}>▦</button>
        </span>
      </section>
      <VolumeBreadcrumbs volume={volume} path={currentPath} items={items} disabled={loading} onVolumeChange={onVolumeChange} onOpen={onOpen} />
      {error && <p className="error">{error}</p>}
      <main
        className={`content vfs-list${dragActive ? ' drag-active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={(event) => openContextMenu(event)}
      >
        <div className="drop-hint" aria-hidden={!dragActive}>
          Rilascia i file in /{currentPath || ''}
        </div>
        {view === 'list' ? <table>
          <thead><tr><th><SortHeader field="name">Nome</SortHeader></th><th>Tipo</th><th><SortHeader field="size">Dimensione</SortHeader></th><th><SortHeader field="lastModified">Modificato</SortHeader></th><th>Azioni</th></tr></thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.virtual ? `virtual-${item.virtualKind}` : item.path} className={`${item.virtual ? 'virtual-entry ' : ''}${dropTarget === item.path ? 'drop-target' : ''}`.trim()} draggable={!item.virtual && !readOnly} onDragStart={(event) => startItemDrag(event, item)} onDragEnd={() => { setDraggedItem(null); setDropTarget(''); }} onDragOver={(event) => { if (draggedItem && item.type === 'directory') { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(item.path); } }} onDragLeave={() => dropTarget === item.path && setDropTarget('')} onDrop={(event) => item.type === 'directory' && dropOnDirectory(event, item)} onContextMenu={(event) => openContextMenu(event, item)}>
                <td>
                  <button
                    type="button"
                    className="file-name-button"
                    onClick={() => item.type === 'directory' ? onOpen(item.path) : onPreview(item)}
                    title={item.virtualKind === 'parent' ? 'Directory superiore' : item.virtualKind === 'current' ? 'Directory corrente' : item.type === 'directory' ? 'Apri cartella' : 'Apri anteprima'}
                  >
                    <span className={`icon icon-${item.type}`} aria-hidden /> {item.name}
                  </button>
                </td>
                <td>{item.virtual ? 'Cartella virtuale' : item.type === 'directory' ? 'Cartella' : 'File'}</td>
                <td>{item.type === 'file' ? formatFileSize(item.size) : '—'}</td>
                <td>{item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}</td>
                <td>
                  <span className="row-actions">
                    {item.type === 'directory'
                      ? <GlyphButton glyph="↳" label={`Apri ${item.name}`} onClick={() => onOpen(item.path)} disabled={operationPath === item.path} />
                      : <>
                        <GlyphButton glyph="◉" label={`Anteprima ${item.name}`} onClick={() => onPreview(item)} disabled={operationPath === item.path} />
                        {!readOnly && isTextPreviewEntry(item) && <GlyphButton glyph="{ }" label={`Modifica ${item.name}`} onClick={() => onEdit(item)} disabled={operationPath === item.path} />}
                        <GlyphButton glyph="⇩" label={`Scarica ${item.name}`} onClick={() => onDownload(item)} disabled={operationPath === item.path} />
                      </>}
                    {!readOnly && !item.virtual && <GlyphButton glyph="✎" label={`Rinomina ${item.name}`} onClick={() => onRename(item)} disabled={operationPath === item.path} />}
                    {!readOnly && !item.virtual && <GlyphButton glyph={operationPath === item.path ? '…' : '×'} label={operationPath === item.path ? `Operazione in corso su ${item.name}` : `Elimina ${item.name}`} className="danger" onClick={() => onDelete(item)} disabled={operationPath === item.path} />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table> : <div className="file-grid">{visibleItems.map((item) => <article key={item.virtual ? `virtual-${item.virtualKind}` : item.path} className={`file-grid-item${item.virtual ? ' virtual-entry' : ''}${dropTarget === item.path ? ' drop-target' : ''}`} draggable={!item.virtual && !readOnly} onDragStart={(event) => startItemDrag(event, item)} onDragEnd={() => { setDraggedItem(null); setDropTarget(''); }} onDragOver={(event) => { if (draggedItem && item.type === 'directory') { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(item.path); } }} onDragLeave={() => dropTarget === item.path && setDropTarget('')} onDrop={(event) => item.type === 'directory' && dropOnDirectory(event, item)} onContextMenu={(event) => openContextMenu(event, item)} onDoubleClick={() => item.type === 'directory' ? onOpen(item.path) : onPreview(item)}>
          <div className="file-grid-preview">{item.type === 'directory' ? <span aria-hidden>📁</span> : isImagePreviewEntry(item) ? <ImageThumbnail item={item} load={onLoadThumbnail} cacheKey={`${volume}:${item.lastModified || 0}`} /> : <span className="grid-file-icon" aria-hidden>📄</span>}</div>
          <strong title={item.name}>{item.name}</strong>
          <small>{item.virtual ? 'Directory superiore' : item.type === 'directory' ? 'Cartella' : formatFileSize(item.size)}</small>
        </article>)}</div>}
        {loading && <p className="loading">Caricamento lista da VFS2…</p>}
        {!loading && visibleItems.every((item) => item.virtual) && <p className="empty-list">Nessun file presente in questa directory.</p>}
        <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
      </main>
    </>
  );
}
