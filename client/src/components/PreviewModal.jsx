import CodePreview from './CodePreview';
import { useEffect, useState } from 'react';

export default function PreviewModal({ preview, onClose, onDownload, onSave }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setDraft(preview?.text || '');
    setSaveError('');
  }, [preview?.item?.path, preview?.text]);

  if (!preview) return null;

  const save = async () => {
    if (!onSave || saving) return;
    setSaving(true); setSaveError('');
    try { await onSave(preview.item, draft, preview.contentType); }
    catch (error) { setSaveError(error?.message || 'Salvataggio non riuscito'); }
    finally { setSaving(false); }
  };

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
            <CodePreview value={draft} item={preview.item} kind={preview.kind} editable={Boolean(preview.editable)} onChange={setDraft} large={Boolean(preview.large)} />
          )}
          {!preview.loading && !preview.error && preview.kind === 'audio' && <audio className="preview-media" src={preview.url} controls autoPlay={false} />}
          {!preview.loading && !preview.error && preview.kind === 'video' && <video className="preview-media" src={preview.url} controls autoPlay={false} />}
        </div>

        <footer className="modal-actions">
          {saveError && <span className="preview-save-error">{saveError}</span>}
          {preview.editable && <button type="button" className="primary" onClick={save} disabled={saving || draft === preview.text}>{saving ? 'Salvataggio…' : 'Salva'}</button>}
          <button type="button" onClick={() => onDownload(preview.item)}>Scarica</button>
          <button type="button" onClick={onClose}>Chiudi</button>
        </footer>
      </section>
    </div>
  );
}
