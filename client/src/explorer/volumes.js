const normalize = (listing, volume) => ({
  path: String(listing?.path || ""),
  items: Array.isArray(listing?.items) ? listing.items.map((item) => ({
    name: String(item.name || ""), path: String(item.path || ""),
    type: item.type === "directory" ? "directory" : "file",
    size: Number(item.size || 0), lastModified: item.lastModified || null, volume,
  })) : [],
});

const normalizeBase = (value) => String(value || "/vfs").replace(/\/+$/, "");
const encodePath = (value) => String(value || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");

export function createVfsUrls(globalObject) {
  const base = normalizeBase(globalObject.VFS_BASE_URL);
  const publicBase = `${base}/public`;
  return {
    publicDirectory(path) {
      const encoded = encodePath(path);
      return `${publicBase}/${encoded ? `${encoded}/` : ""}`;
    },
    publicFile(path) {
      return `${publicBase}/${encodePath(path)}`;
    },
  };
}

export function createVolumes(globalObject, getApi) {
  const urls = createVfsUrls(globalObject);
  return {
    private: {
      writable: true,
      available: () => Boolean(globalObject.VfsAuth?.getSession?.()),
      list: async (path) => normalize(await getApi().list(path), "private"),
      async fetch(path) {
        const token = await globalObject.VfsAuth.getAccessToken();
        return fetch(getApi().downloadUrl(path, false), { headers: { Authorization: `Bearer ${token}` } });
      },
    },
    public: {
      writable: false,
      available: () => true,
      async list(path) {
        const normalized = String(path || "").replace(/^\/+|\/+$/g, "");
        const response = await fetch(urls.publicDirectory(normalized));
        if (!response.ok) throw new Error(`Elenco pubblico non disponibile (${response.status})`);
        const listing = normalize(await response.json(), "public");
        listing.items = listing.items.map((item) => item.type === "file" ? { ...item, url: urls.publicFile(item.path) } : item);
        return listing;
      },
      fetch(path) {
        return fetch(urls.publicFile(path));
      },
    },
  };
}
