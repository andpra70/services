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

export function validateEntryName(value = '') {
  const name = String(value).trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Nome non valido: non usare slash, backslash, “.” o “..”');
  }
  return name;
}

export function formatFileSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'md', 'csv', 'log', 'xml', 'html', 'htm', 'css', 'js', 'jsx',
  'ts', 'tsx', 'yaml', 'yml', 'ini', 'conf', 'sh', 'sql',
]);

export function fileExtension(name = '') {
  const filename = String(name).toLowerCase();
  const separator = filename.lastIndexOf('.');
  return separator >= 0 ? filename.slice(separator + 1) : '';
}

export function previewKindForEntry(entry, contentType = '') {
  const extension = fileExtension(entry?.name);
  const mime = String(contentType || '').toLowerCase().split(';')[0];

  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (mime === 'application/json' || extension === 'json') return 'json';
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'unsupported';
}
