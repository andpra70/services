export function normalizeVfsEntry(entry = {}) {
  return {
    name: String(entry.name || ''), path: String(entry.path || ''),
    type: entry.type === 'directory' ? 'directory' : 'file',
    size: Number(entry.size || 0), lastModified: entry.lastModified || null,
    publicUrl: entry.publicUrl || '', downloadUrl: entry.downloadUrl || '',
  };
}

export function normalizeVfsListing(listing = {}) {
  return {
    path: String(listing.path || ''), cached: Boolean(listing.cached),
    items: Array.isArray(listing.items) ? listing.items.map(normalizeVfsEntry) : [],
  };
}

export function parentDirectory(path = '') {
  return String(path).split('/').filter(Boolean).slice(0, -1).join('/');
}

export function formatFileSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
