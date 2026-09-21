(function (g) {
  "use strict";
  var base = "/vfs/api";
  async function call(path, opt) {
    var token = await g.VfsAuth.getAccessToken();
    var request = function () {
      return fetch(base + path, Object.assign({}, opt, {
        headers: Object.assign({}, opt && opt.headers, { Authorization: "Bearer " + token })
      }));
    };
    var response = await request();
    if (response.status === 401) {
      await g.VfsAuth.refresh();
      token = await g.VfsAuth.getAccessToken();
      response = await request();
    }
    if (!response.ok) {
      var payload = await response.json().catch(function () { return {}; });
      throw new Error(payload.error || String(response.status));
    }
    var type = response.headers.get("content-type") || "";
    return type.includes("json") ? response.json() : response;
  }
  async function upload(path, file, options) {
    var form = new FormData();
    form.append("path", path || "");
    form.append("file", file);
    if (options && options.name) form.append("name", options.name);
    form.append("download", String(!!(options && options.download)));
    return call("/upload", { method: "POST", body: form });
  }
  function jsonCall(path, method, body) {
    return call(path, { method: method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  g.VfsWidget = Object.freeze({
    list: function (path) { return call("/list?path=" + encodeURIComponent(path || "")); },
    upload: upload,
    mkdir: function (path) { return jsonCall("/mkdir", "POST", { path: path }); },
    rmfile: function (path) { return jsonCall("/file", "DELETE", { path: path }); },
    rmdir: function (path, options) { return jsonCall("/rmdir", "DELETE", { path: path, recursive: !!(options && options.recursive) }); },
    rename: function (sourcePath, targetPath, type) { return jsonCall("/rename", "POST", { sourcePath: sourcePath, targetPath: targetPath, type: type }); },
    publish: function (sourcePath, publicPath) { return jsonCall("/publish", "POST", { sourcePath: sourcePath, publicPath: publicPath }); },
    unpublish: function (publicPath) { return jsonCall("/public", "DELETE", { publicPath: publicPath }); },
    downloadUrl: function (path, force) { return base + "/download?path=" + encodeURIComponent(path) + (force ? "&download=true" : ""); },
    salvaFileTesto: function (path, content, mime) {
      var parts = path.split("/");
      var name = parts.pop();
      var directory = parts.join("/");
      var text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      return upload(directory, new Blob([text], { type: mime || "text/plain" }), { name: name });
    }
  });
})(window);
