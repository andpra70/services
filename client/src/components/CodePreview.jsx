import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { fileExtension } from '../models.js';

function languageFor(name, kind) {
  const extension = fileExtension(name);
  if (kind === 'json' || extension === 'json') return json();
  return [];
}

export default function CodePreview({ value, item, kind, editable = false, onChange, large = false }) {
  if (large) {
    return <textarea className="preview-large-editor" value={value || ''} readOnly={!editable} onChange={(event) => onChange?.(event.target.value)} spellCheck={false} aria-label={`Contenuto di ${item?.name || 'file'}`} />;
  }
  const language = languageFor(item?.name, kind);
  return <CodeMirror className="preview-code-editor" value={value || ''} height="min(68vh, 720px)" extensions={Array.isArray(language) ? language : [language]} editable={editable} onChange={onChange} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: editable, highlightActiveLineGutter: editable }} />;
}
