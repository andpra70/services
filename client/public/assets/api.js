(function (global) {
  'use strict';

  function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function toQuery(params) {
    var query = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      query.set(key, value == null ? '' : String(value));
    });
    return query.toString();
  }

  function parseFilename(contentDisposition, fallbackName) {
    var match = String(contentDisposition || '').match(/filename="?([^";]+)"?/i);
    return (match && match[1]) || fallbackName;
  }

  function createClient(options) {
    var config = options || {};
    var apiBase = trimTrailingSlash(config.apiBase || '/api');

    async function api(path, requestOptions) {
      var response = await fetch(apiBase + path, requestOptions || {});

      if (!response.ok) {
        var message = 'Request failed: ' + response.status;
        try {
          var body = await response.json();
          if (body && body.error) {
            message = body.error;
          }
        } catch (_error) {
          // ignore response parsing errors
        }
        throw new Error(message);
      }

      var contentType = response.headers.get('content-type') || '';
      if (contentType.indexOf('application/json') >= 0) {
        return response.json();
      }
      return response;
    }

    return {
      listDirectory: function (relativePath) {
        return api('/list?' + toQuery({ path: relativePath || '' }));
      },
      createFolder: function (path, name) {
        return api('/folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path, name: name })
        });
      },
      uploadFiles: function (path, files, onProgress) {
        var formData = new FormData();
        formData.append('path', path || '');
        Array.from(files || []).forEach(function (file) {
          formData.append('files', file);
        });

        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', apiBase + '/upload');

          xhr.onload = function () {
            if (xhr.status < 200 || xhr.status >= 300) {
              try {
                var body = JSON.parse(xhr.responseText);
                reject(new Error((body && body.error) || ('Request failed: ' + xhr.status)));
              } catch (_error) {
                reject(new Error('Request failed: ' + xhr.status));
              }
              return;
            }

            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (_error) {
              resolve({ ok: true });
            }
          };

          xhr.onerror = function () {
            reject(new Error('Upload failed'));
          };

          xhr.upload.onprogress = function (event) {
            if (typeof onProgress === 'function' && event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          };

          xhr.send(formData);
        });
      },
      deleteItem: function (path) {
        return api('/item?' + toQuery({ path: path }), { method: 'DELETE' });
      },
      renameItem: function (path, newName) {
        return api('/rename', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path, newName: newName })
        });
      },
      downloadFile: async function (path) {
        var response = await api('/download?' + toQuery({ path: path }));
        var blob = await response.blob();
        return {
          blob: blob,
          filename: parseFilename(response.headers.get('content-disposition'), (path || '').split('/').pop() || 'file.bin')
        };
      },
      loadRawFileBlob: async function (path) {
        var response = await api('/raw?' + toQuery({ path: path }));
        return {
          blob: await response.blob(),
          contentType: response.headers.get('content-type') || 'application/octet-stream'
        };
      },
      createArchive: async function (paths, archiveName) {
        var response = await api('/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: paths, archiveName: archiveName || 'archive.zip' })
        });

        return {
          blob: await response.blob(),
          filename: parseFilename(response.headers.get('content-disposition'), archiveName || 'archive.zip')
        };
      },
      loadFileContent: function (path) {
        return api('/file-content?' + toQuery({ path: path }));
      },
      saveFileContent: function (path, content) {
        return api('/file-content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path, content: content })
        });
      }
    };
  }

  global.FileserverApi = {
    createClient: createClient
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
