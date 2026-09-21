import { useCallback, useEffect, useState } from 'react';
import AuthPanel from './components/AuthPanel';
import ExplorerLauncher from './components/ExplorerLauncher';
import FileList from './components/FileList';
import PreviewModal from './components/PreviewModal';
import { createDirectory, deleteItem, downloadFile, downloadPublicFile, getSession, initializeVfs, listDirectory, listPublicDirectory, loadFilePreview, loadPublicFilePreview, login, logout, renameItem, uploadFile } from './api';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [volume, setVolume] = useState('public');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [operationPath, setOperationPath] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (path = currentPath, targetVolume = volume) => {
    setLoading(true);
    setError('');
    try {
      const listing = targetVolume === 'private' ? await listDirectory(path) : await listPublicDirectory(path);
      setVolume(targetVolume);
      setCurrentPath(listing.path);
      setItems(listing.items);
    } catch (err) {
      setError(err.message || 'Impossibile caricare la lista VFS2');
    } finally {
      setLoading(false);
    }
  }, [currentPath, volume]);

  useEffect(() => {
    let active = true;
    initializeVfs()
      .then(async () => {
        let nextSession = getSession();
        if (!nextSession) {
          try {
            await window.VfsAuth.getAccessToken();
            nextSession = getSession();
          } catch {
            nextSession = null;
          }
        }
        if (!active) return;
        setSession(nextSession);
        setReady(true);
        await refresh('', nextSession ? 'private' : 'public');
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Impossibile inizializzare OAuth2/VFS2');
        setReady(true);
      });
    return () => { active = false; };
  }, []);

  async function handleLogout() {
    await logout();
    setSession(null);
    await refresh('', 'public');
  }

  function handleVolumeChange(nextVolume) {
    if (nextVolume === 'private' && !session) {
      login();
      return;
    }
    closePreview();
    refresh('', nextVolume);
  }

  async function handleUpload(files) {
    const pendingFiles = Array.from(files || []);
    if (!pendingFiles.length) return;
    try {
      setError('');
      setUploading(true);
      for (const file of pendingFiles) {
        await uploadFile(currentPath, file);
      }
      await refresh(currentPath);
    } catch (err) {
      setError(err.message || 'Upload non riuscito');
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateDirectory(name) {
    try {
      setError('');
      await createDirectory(currentPath ? `${currentPath}/${name}` : name);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message || 'Creazione cartella non riuscita');
    }
  }

  async function handleDownload(item) {
    try {
      setError('');
      await (volume === 'public' ? downloadPublicFile(item) : downloadFile(item));
    } catch (err) {
      setError(err.message || 'Download non riuscito');
    }
  }

  function closePreview() {
    setPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function handlePreview(item) {
    closePreview();
    setPreview({ item, loading: true, error: '', kind: '', text: '', url: '' });
    try {
      const content = await (volume === 'public' ? loadPublicFilePreview(item) : loadFilePreview(item));
      setPreview((current) => {
        if (current?.item.path === item.path) {
          return { item, loading: false, error: '', ...content };
        }
        if (content.url) URL.revokeObjectURL(content.url);
        return current;
      });
    } catch (err) {
      setPreview((current) => current?.item.path === item.path
        ? { ...current, loading: false, error: err.message || 'Anteprima non disponibile' }
        : current);
    }
  }

  async function handleDelete(item) {
    const detail = item.type === 'directory'
      ? 'La cartella e tutto il suo contenuto saranno eliminati definitivamente.'
      : 'Il file sarà eliminato definitivamente.';
    if (!window.confirm(`Eliminare “${item.name}”?\n\n${detail}`)) return;

    try {
      setError('');
      setOperationPath(item.path);
      if (preview?.item.path === item.path) closePreview();
      await deleteItem(item);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message || 'Eliminazione non riuscita');
    } finally {
      setOperationPath('');
    }
  }

  async function handleRename(item) {
    const requestedName = window.prompt(`Nuovo nome per “${item.name}”`, item.name);
    if (requestedName === null || requestedName.trim() === item.name) return;

    try {
      setError('');
      setOperationPath(item.path);
      if (preview?.item.path === item.path) closePreview();
      await renameItem(item, requestedName);
      await refresh(currentPath);
    } catch (err) {
      const message = err.message === 'target_exists'
        ? 'Esiste già un elemento con questo nome.'
        : err.message || 'Rinomina non riuscita';
      setError(message);
    } finally {
      setOperationPath('');
    }
  }

  return (
    <div className="desktop">
      <header className="topbar">
        <div className="window-controls" aria-hidden><span /><span /><span /></div>
        <h1>Fileserver VFS2</h1>
        <ExplorerLauncher ready={ready} />
      </header>
      <AuthPanel ready={ready} session={session} error={error} onLogin={login} onLogout={handleLogout} />
      {ready && (
        <FileList
          volume={volume}
          currentPath={currentPath}
          items={items}
          loading={loading}
          uploading={uploading}
          operationPath={operationPath}
          error={error}
          onVolumeChange={handleVolumeChange}
          onOpen={refresh}
          onRefresh={() => refresh(currentPath)}
          onUpload={handleUpload}
          onCreateDirectory={handleCreateDirectory}
          onDownload={handleDownload}
          onPreview={handlePreview}
          onDelete={handleDelete}
          onRename={handleRename}
        />
      )}
      <PreviewModal preview={preview} onClose={closePreview} onDownload={handleDownload} />
    </div>
  );
}
