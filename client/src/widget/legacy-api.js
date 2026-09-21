export function createLegacyApi(globalObject, open) {
  const vfsBase = String(globalObject.VFS_BASE_URL || "/vfs").replace(/\/+$/, "");
  const base = `${vfsBase}/api`;
  async function call(path, options) {
    let token = await globalObject.VfsAuth.getAccessToken();
    const request = () => fetch(base + path, {
      ...options,
      headers: { ...(options?.headers || {}), Authorization: `Bearer ${token}` },
    });
    let response = await request();
    if (response.status === 401) {
      await globalObject.VfsAuth.refresh();
      token = await globalObject.VfsAuth.getAccessToken();
      response = await request();
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || String(response.status));
    }
    return (response.headers.get("content-type") || "").includes("json") ? response.json() : response;
  }
  async function upload(path, file, options) {
    const form = new FormData();
    form.append("path", path || "");
    form.append("file", file);
    if (options?.name) form.append("name", options.name);
    form.append("download", String(Boolean(options?.download)));
    return call("/upload", { method: "POST", body: form });
  }
  const jsonCall = (path, method, body) => call(path, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return Object.freeze({
    list: (path) => call(`/list?path=${encodeURIComponent(path || "")}`),
    upload,
    mkdir: (path) => jsonCall("/mkdir", "POST", { path }),
    rmfile: (path) => jsonCall("/file", "DELETE", { path }),
    rmdir: (path, options) => jsonCall("/rmdir", "DELETE", { path, recursive: Boolean(options?.recursive) }),
    rename: (sourcePath, targetPath, type) => jsonCall("/rename", "POST", { sourcePath, targetPath, type }),
    publish: (sourcePath, publicPath) => jsonCall("/publish", "POST", { sourcePath, publicPath }),
    unpublish: (publicPath) => jsonCall("/public", "DELETE", { publicPath }),
    downloadUrl: (path, force) => `${base}/download?path=${encodeURIComponent(path)}${force ? "&download=true" : ""}`,
    salvaFileTesto(path, content, mime) {
      const parts = path.split("/");
      const name = parts.pop();
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      return upload(parts.join("/"), new Blob([text], { type: mime || "text/plain" }), { name });
    },
    open,
  });
}
