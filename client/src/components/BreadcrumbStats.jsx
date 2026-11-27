import { useEffect, useMemo, useState } from 'react';
import { formatFileSize } from '../models';

export default function BreadcrumbStats({ volume, path, items }) {
  const [opfs, setOpfs] = useState(null);
  const summary = useMemo(() => {
    const entries = Array.isArray(items) ? items : [];
    return {
      files: entries.filter((item) => item.type === 'file').length,
      directories: entries.filter((item) => item.type === 'directory').length,
      size: entries.reduce((total, item) => total + (item.type === 'file' ? Number(item.size || 0) : 0), 0),
    };
  }, [items]);

  useEffect(() => {
    let active = true;
    if (volume !== 'local' || !window.VfsWidget?.localVfs) { setOpfs(null); return undefined; }
    Promise.all([window.VfsWidget.localVfs.stat(path), window.VfsWidget.localVfs.free()])
      .then(([stat, free]) => { if (active) setOpfs({ stat, free }); })
      .catch(() => { if (active) setOpfs(null); });
    return () => { active = false; };
  }, [volume, path, items]);

  const title = opfs
    ? `${opfs.stat.files} file, ${opfs.stat.directories} cartelle · Contenuto ${formatFileSize(opfs.stat.size)} · OPFS ${formatFileSize(opfs.free.opfsUsed)} · Occupato origine ${formatFileSize(opfs.free.used)} · Libero ${formatFileSize(opfs.free.free)} · Quota ${formatFileSize(opfs.free.quota)}`
    : `${summary.files} file, ${summary.directories} cartelle, ${formatFileSize(summary.size)}`;

  const visible = opfs
    ? `${formatFileSize(opfs.free.opfsUsed)} usati · ${formatFileSize(opfs.free.free)} liberi`
    : `${summary.files} file · ${summary.directories} cartelle · ${formatFileSize(summary.size)}`;

  return <span className="breadcrumb-stats" tabIndex={0} title={title} aria-label={`Statistiche: ${title}`}>
    <span aria-hidden>ⓘ</span><span className="breadcrumb-stats-summary">{visible}</span>
    <span className="breadcrumb-stats-tooltip" role="tooltip">{title}</span>
  </span>;
}
