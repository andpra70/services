export default function VolumeBreadcrumbs({ volume, path, disabled, onVolumeChange, onOpen }) {
  const segments = String(path || '').split('/').filter(Boolean);

  return (
    <nav className="breadcrumbs" aria-label="Percorso filesystem">
      <button type="button" onClick={() => onVolumeChange('private')} disabled={disabled} className={volume === 'private' ? 'active' : ''}>Privato</button>
      <button type="button" onClick={() => onVolumeChange('public')} disabled={disabled} className={volume === 'public' ? 'active' : ''}>Pubblico</button>
      <span className="breadcrumb-separator">/</span>
      <button type="button" onClick={() => onOpen('')} disabled={disabled}>{volume === 'private' ? 'private' : 'public'}</button>
      {segments.map((segment, index) => (
        <span className="breadcrumb-part" key={`${segment}-${index}`}>
          <span className="breadcrumb-separator">/</span>
          <button type="button" onClick={() => onOpen(segments.slice(0, index + 1).join('/'))} disabled={disabled}>{segment}</button>
        </span>
      ))}
    </nav>
  );
}
