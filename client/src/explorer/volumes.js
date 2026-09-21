const normalize = (listing, volume) => ({
  path: String(listing?.path || ""),
  items: Array.isArray(listing?.items) ? listing.items.map((item) => ({
    name: String(item.name || ""), path: String(item.path || ""),
    type: item.type === "directory" ? "directory" : "file",
    size: Number(item.size || 0), lastModified: item.lastModified || null, volume,
  })) : [],
});

export function createVolumes(globalObject, getApi) {
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
        const response = await fetch(`/vfs/public/${normalized ? `${normalized}/` : ""}`);
        if (!response.ok) throw new Error(`Elenco pubblico non disponibile (${response.status})`);
        return normalize(await response.json(), "public");
      },
      fetch(path) {
        return fetch(`/vfs/public/${String(path).split("/").map(encodeURIComponent).join("/")}`);
      },
    },
  };
}
