import { getValidAccessToken, redirectToLogin } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function withAuthHeaders(headers = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    await redirectToLogin();
    throw new Error('Authentication required');
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

async function api(path, options = {}) {
  const headers = await withAuthHeaders(options.headers || {});
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    await redirectToLogin();
    throw new Error('Authentication required');
  }

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
  const authHeaders = await withAuthHeaders();
  const formData = new FormData();
  formData.append('path', path);
  Array.from(files).forEach((file) => formData.append('files', file));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload`);
    xhr.setRequestHeader('Authorization', authHeaders.Authorization);

    xhr.onload = async () => {
      if (xhr.status === 401) {
        await redirectToLogin();
        reject(new Error('Authentication required'));
        return;
      }

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
  return api(`/file-content?${query.toString()}`);
}

export function saveFileContent(path, content) {
  return api('/file-content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}
