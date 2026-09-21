import { useState } from 'react';

export default function ExplorerLauncher({ ready }) {
  const [result, setResult] = useState('');
  const [opening, setOpening] = useState(false);

  async function openExplorer() {
    setResult('');
    setOpening(true);
    try {
      if (typeof window.VfsWidget?.open !== 'function') {
        throw new Error('La versione caricata di VfsWidget non espone open()');
      }
      const selection = await window.VfsWidget.open();
      setResult(selection ? JSON.stringify(selection) : 'Selezione annullata');
    } catch (error) {
      setResult(error?.message || 'Impossibile aprire il file explorer');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="explorer-launcher">
      <button type="button" disabled={!ready || opening} onClick={openExplorer}>
        {opening ? 'Explorer aperto…' : 'Apri File Explorer'}
      </button>
      {result && <output title={result}>{result}</output>}
    </div>
  );
}
