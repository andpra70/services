const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const OAUTH_STORAGE_KEYS = [
  import.meta.env.VITE_OAUTH_STORAGE_KEY || 'oauth-example',
  'oauth-authWidget',
  'oauth-example',
  'fileserver-oauth-widget',
  'oauth-widget',
];

function getAccessToken() {
  for (const storageKey of OAUTH_STORAGE_KEYS) {
    try {
      const payload = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
      if (typeof payload?.tokens?.access_token === 'string') {
        return payload.tokens.access_token;
      }
    } catch {
      // ignore parse errors
    }
  }
  return '';
}

function withAuthHeaders(inputHeaders = {}) {
  const headers = new Headers(inputHeaders);
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: withAuthHeaders(options.headers),
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res;
}

export function listDirectory(relativePath = '') {
  const query = new URLSearchParams({ path: relativePath });
  return api(`/list?${query.toString()}`);
}

export function createFolder(path, name) {
  return api('/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  });
}

export async function uploadFiles(path, files, onProgress) {
  const formData = new FormData();
  formData.append('path', path);
  Array.from(files).forEach((file) => formData.append('files', file));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload`);
    const token = getAccessToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body?.error || `Request failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Request failed: ${xhr.status}`));
        }
        return;
      }

      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve({ ok: true });
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.upload.onprogress = (event) => {
      if (typeof onProgress === 'function' && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.send(formData);
  });
}

export function deleteItem(path) {
  const query = new URLSearchParams({ path });
  return api(`/item?${query.toString()}`, { method: 'DELETE' });
}

export function renameItem(path, newName) {
  return api('/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, newName }),
  });
}

export function moveItems(paths, targetPath) {
  return api('/move', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, targetPath }),
  });
}

export async function downloadFile(path) {
  const query = new URLSearchParams({ path });
  const res = await api(`/download?${query.toString()}`);
  const blob = await res.blob();
  const contentDisposition = res.headers.get('content-disposition') || '';
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return { blob, filename: match?.[1] || path.split('/').pop() || 'file.bin' };
}

export async function loadRawFileBlob(path) {
  const query = new URLSearchParams({ path });
  const res = await api(`/raw?${query.toString()}`);
  const blob = await res.blob();
  return { blob, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

export async function createArchive(paths, archiveName = 'archive.zip') {
  const res = await api('/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, archiveName }),
  });

  const blob = await res.blob();
  const contentDisposition = res.headers.get('content-disposition') || '';
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || archiveName;
  return { blob, filename };
}

export function loadFileContent(path) {
  const query = new URLSearchParams({ path });
  return api(`/file-content?${query.toString()}`).then(async (res) => {
    const buffer = await res.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    return {
      path,
      content: decoder.decode(buffer),
      size: buffer.byteLength,
    };
  });
}

export function saveFileContent(path, content) {
  const query = new URLSearchParams({ path });
  const encoder = new TextEncoder();
  const payload = content instanceof Uint8Array ? content : encoder.encode(String(content));
  return api(`/file-content?${query.toString()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: payload,
  });
}

export async function printPdf(html, filename = 'document.pdf') {
  const res = await api('/print-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, filename }),
  });

  const blob = await res.blob();
  const contentDisposition = res.headers.get('content-disposition') || '';
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return { blob, filename: match?.[1] || filename };
}
