export default function AuthPanel({ ready, session, error, onLogin, onLogout }) {
  return (
    <section className="auth-panel">
      <div>
        <strong>{session ? session.user?.name || session.user?.email : 'OAuth2'}</strong>
        <span>{session ? session.user?.email : ready ? 'Accesso richiesto per consultare VFS2' : 'Verifica sessione…'}</span>
      </div>
      {session
        ? <button type="button" onClick={onLogout}>Esci</button>
        : <button type="button" onClick={onLogin} disabled={!ready}>Accedi con Google</button>}
      {!session && error && <span className="error-inline">{error}</span>}
    </section>
  );
}
