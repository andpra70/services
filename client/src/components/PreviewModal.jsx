export default function PreviewModal({ preview, onClose, onDownload }) {
  if (!preview) return null;

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <header className="preview-header">
          <div>
            <h3 id="preview-title">{preview.item.name}</h3>
            <span>{preview.item.path}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Chiudi anteprima">Chiudi</button>
        </header>

        <div className="preview-body">
          {preview.loading && <p className="loading">Caricamento anteprima…</p>}
          {preview.error && <p className="error preview-error">{preview.error}</p>}
          {!preview.loading && !preview.error && preview.warning && <p className="preview-warning">{preview.warning}</p>}
          {!preview.loading && !preview.error && preview.kind === 'image' && (
            <img className="preview-image" src={preview.url} alt={preview.item.name} />
          )}
          {!preview.loading && !preview.error && preview.kind === 'pdf' && (
            <iframe className="preview-pdf" src={preview.url} title={`Anteprima ${preview.item.name}`} />
          )}
          {!preview.loading && !preview.error && ['text', 'json'].includes(preview.kind) && (
            <pre className="preview-text">{preview.text}</pre>
          )}
        </div>

        <footer className="modal-actions">
          <button type="button" onClick={() => onDownload(preview.item)}>Scarica</button>
          <button type="button" onClick={onClose}>Chiudi</button>
        </footer>
      </section>
    </div>
  );
}
