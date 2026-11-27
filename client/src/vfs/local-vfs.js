const normalizePath = (value = '') => {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = raw ? raw.split('/') : [];
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('invalid_path');
  }
  return parts;
};

const joinPath = (...parts) => parts.flatMap(normalizePath).join('/');

function opfsError(error) {
  if (error?.name === 'NotFoundError') return new Error('not_found');
  if (error?.name === 'TypeMismatchError') return new Error('type_mismatch');
  if (error?.name === 'InvalidModificationError') return new Error('directory_not_empty');
  if (error?.name === 'NoModificationAllowedError') return new Error('not_writable');
  return error;
}

export function createLocalVfs(globalObject = window) {
  const storage = globalObject.navigator?.storage;
  if (typeof storage?.getDirectory !== 'function') return null;

  const root = () => storage.getDirectory();

  async function directory(path = '', create = false) {
    let handle = await root();
    for (const name of normalizePath(path)) handle = await handle.getDirectoryHandle(name, { create });
    return handle;
  }

  async function parentAndName(path, createParent = false) {
    const parts = normalizePath(path);
    const name = parts.pop();
    if (!name) throw new Error('invalid_path');
    return { parent: await directory(parts.join('/'), createParent), name };
  }

  async function entry(path) {
    const { parent, name } = await parentAndName(path);
    try { return await parent.getFileHandle(name); }
    catch (error) {
      if (error?.name !== 'TypeMismatchError') throw error;
      return parent.getDirectoryHandle(name);
    }
  }

  async function list(path = '') {
    try {
      const normalized = normalizePath(path).join('/');
      const handle = await directory(normalized);
      const items = [];
      for await (const [name, child] of handle.entries()) {
        const childPath = joinPath(normalized, name);
        if (child.kind === 'file') {
          const file = await child.getFile();
          items.push({ name, path: childPath, type: 'file', size: file.size, lastModified: file.lastModified });
        } else {
          items.push({ name, path: childPath, type: 'directory', size: 0, lastModified: null });
        }
      }
      return { path: normalized, cached: false, items };
    } catch (error) { throw opfsError(error); }
  }

  async function upload(path, file, options = {}) {
    try {
      const name = options.name || file?.name;
      if (!name || normalizePath(name).length !== 1) throw new Error('invalid_name');
      const target = await (await directory(path, true)).getFileHandle(name, { create: true });
      const writable = await target.createWritable();
      try { await writable.write(file); await writable.close(); }
      catch (error) { await writable.abort().catch(() => {}); throw error; }
      const stored = await target.getFile();
      return { name, path: joinPath(path, name), type: 'file', size: stored.size, lastModified: stored.lastModified };
    } catch (error) { throw opfsError(error); }
  }

  async function mkdir(path) {
    try { await directory(path, true); return { path: normalizePath(path).join('/'), type: 'directory' }; }
    catch (error) { throw opfsError(error); }
  }

  async function rmfile(path) {
    try { const { parent, name } = await parentAndName(path); await parent.removeEntry(name); return { path: normalizePath(path).join('/') }; }
    catch (error) { throw opfsError(error); }
  }

  async function rmdir(path, options = {}) {
    try {
      const { parent, name } = await parentAndName(path);
      await parent.getDirectoryHandle(name);
      await parent.removeEntry(name, { recursive: Boolean(options.recursive) });
      return { path: normalizePath(path).join('/') };
    } catch (error) { throw opfsError(error); }
  }

  async function copyDirectory(source, target) {
    for await (const [name, child] of source.entries()) {
      if (child.kind === 'file') {
        const output = await target.getFileHandle(name, { create: true });
        const writable = await output.createWritable();
        await writable.write(await child.getFile());
        await writable.close();
      } else {
        await copyDirectory(child, await target.getDirectoryHandle(name, { create: true }));
      }
    }
  }

  async function rename(sourcePath, targetPath, type) {
    try {
      const normalizedSource = normalizePath(sourcePath).join('/');
      const normalizedTarget = normalizePath(targetPath).join('/');
      if (normalizedSource === normalizedTarget) return { sourcePath: normalizedSource, targetPath: normalizedTarget, type };
      if (normalizedTarget.startsWith(`${normalizedSource}/`)) throw new Error('invalid_target');
      const source = await entry(sourcePath);
      if (type && source.kind !== type) throw new Error('type_mismatch');
      const { parent: targetParent, name: targetName } = await parentAndName(targetPath, true);
      try { await targetParent.getFileHandle(targetName); throw new Error('target_exists'); }
      catch (error) { if (error?.name !== 'NotFoundError') throw error; }
      try { await targetParent.getDirectoryHandle(targetName); throw new Error('target_exists'); }
      catch (error) { if (error?.name !== 'NotFoundError') throw error; }

      if (source.kind === 'file') {
        const target = await targetParent.getFileHandle(targetName, { create: true });
        const writable = await target.createWritable();
        await writable.write(await source.getFile());
        await writable.close();
        await rmfile(sourcePath);
      } else {
        const target = await targetParent.getDirectoryHandle(targetName, { create: true });
        try { await copyDirectory(source, target); }
        catch (error) { await targetParent.removeEntry(targetName, { recursive: true }).catch(() => {}); throw error; }
        await rmdir(sourcePath, { recursive: true });
      }
      return { sourcePath: normalizedSource, targetPath: normalizedTarget, type: source.kind };
    } catch (error) { throw opfsError(error); }
  }

  async function readFile(path) {
    try {
      const handle = await entry(path);
      if (handle.kind !== 'file') throw new Error('type_mismatch');
      return handle.getFile();
    } catch (error) { throw opfsError(error); }
  }

  async function fetchFile(path) {
    const file = await readFile(path);
    return new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'content-length': String(file.size) } });
  }

  async function directoryStats(handle) {
    const totals = { size: 0, files: 0, directories: 0 };
    for await (const child of handle.values()) {
      if (child.kind === 'file') {
        totals.size += (await child.getFile()).size;
        totals.files += 1;
      } else {
        const nested = await directoryStats(child);
        totals.size += nested.size;
        totals.files += nested.files;
        totals.directories += nested.directories + 1;
      }
    }
    return totals;
  }

  async function stat(path = '') {
    try {
      const normalized = normalizePath(path).join('/');
      if (!normalized) return { name: '', path: '', type: 'directory', lastModified: null, ...await directoryStats(await root()) };
      const handle = await entry(normalized);
      if (handle.kind === 'directory') return { name: handle.name, path: normalized, type: 'directory', lastModified: null, ...await directoryStats(handle) };
      const file = await handle.getFile();
      return { name: file.name, path: normalized, type: 'file', size: file.size, lastModified: file.lastModified, mime: file.type };
    } catch (error) { throw opfsError(error); }
  }

  async function free() {
    const estimate = await storage.estimate();
    const quota = Number(estimate.quota || 0);
    const used = Number(estimate.usage || 0);
    const opfsUsed = (await directoryStats(await root())).size;
    return { quota, used, free: Math.max(0, quota - used), opfsUsed, usageDetails: estimate.usageDetails || {} };
  }

  async function salvaFileTesto(path, content, mime) {
    const parts = normalizePath(path);
    const name = parts.pop();
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    return upload(parts.join('/'), new Blob([text], { type: mime || 'text/plain' }), { name });
  }

  return Object.freeze({ list, upload, mkdir, rmfile, rmdir, rename, readFile, fetch: fetchFile, stat, free, salvaFileTesto });
}
