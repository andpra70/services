import { useCallback, useEffect, useState } from 'react';
import AuthPanel from './components/AuthPanel';
import FileList from './components/FileList';
import { createDirectory, downloadFile, getSession, initializeVfs, listDirectory, login, logout, uploadFile } from './api';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (path = currentPath) => {
    setLoading(true);
    setError('');
    try {
      const listing = await listDirectory(path);
      setCurrentPath(listing.path);
      setItems(listing.items);
    } catch (err) {
      setError(err.message || 'Impossibile caricare la lista VFS2');
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

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
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Impossibile inizializzare OAuth2/VFS2');
        setReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session) refresh('');
  }, [session]);

  async function handleLogout() {
    await logout();
    setSession(null);
    setItems([]);
    setCurrentPath('');
  }

  async function handleUpload(file) {
    try {
      setError('');
      await uploadFile(currentPath, file);
      await refresh(currentPath);
    } catch (err) {
      setError(err.message || 'Upload non riuscito');
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
      await downloadFile(item);
    } catch (err) {
      setError(err.message || 'Download non riuscito');
    }
  }

  return (
    <div className="desktop">
      <header className="topbar">
        <div className="window-controls" aria-hidden><span /><span /><span /></div>
        <h1>Fileserver VFS2</h1>
      </header>
      <AuthPanel ready={ready} session={session} error={error} onLogin={login} onLogout={handleLogout} />
      {session && (
        <FileList
          currentPath={currentPath}
          items={items}
          loading={loading}
          error={error}
          onOpen={refresh}
          onRefresh={() => refresh(currentPath)}
          onUpload={handleUpload}
          onCreateDirectory={handleCreateDirectory}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
}
