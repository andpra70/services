import BreadcrumbStats from './BreadcrumbStats';

export default function VolumeBreadcrumbs({ volume, path, items, disabled, onVolumeChange, onOpen }) {
  const segments = String(path || '').split('/').filter(Boolean);

  return (
    <nav className="breadcrumbs" aria-label="Percorso filesystem">
      <button type="button" onClick={() => onVolumeChange('local')} disabled={disabled} className={volume === 'local' ? 'active' : ''}>Locale</button>
      <button type="button" onClick={() => onVolumeChange('private')} disabled={disabled} className={volume === 'private' ? 'active' : ''}>Privato</button>
      <button type="button" onClick={() => onVolumeChange('public')} disabled={disabled} className={volume === 'public' ? 'active' : ''}>Pubblico</button>
      <span className="breadcrumb-separator">/</span>
      <button type="button" onClick={() => onOpen('')} disabled={disabled}>{volume}</button>
      {segments.map((segment, index) => (
        <span className="breadcrumb-part" key={`${segment}-${index}`}>
          <span className="breadcrumb-separator">/</span>
          <button type="button" onClick={() => onOpen(segments.slice(0, index + 1).join('/'))} disabled={disabled}>{segment}</button>
        </span>
      ))}
      <BreadcrumbStats volume={volume} path={path} items={items} />
    </nav>
  );
}
