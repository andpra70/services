# File Server + Web Explorer

Server API Express e client React/Vite serviti dallo stesso container.

## Funzioni

- Navigazione cartelle
- Upload multipart multi-file
- Drag & drop upload direttamente nella tabella file
- Barra di progresso upload
- Download file
- Download ZIP di una cartella
- Multi-selezione con azioni batch
- Download ZIP della selezione multipla
- Eliminazione file/cartelle singola e batch
- Rinomina file/cartelle
- Creazione cartelle
- Modifica contenuto file di testo
- Anteprima file immagini/PDF/testo
- Ricerca locale nella cartella corrente
- Ordinamento per nome, data, dimensione

## Struttura

- `server/`: API Express + serving del frontend buildato
- `client/`: applicazione web React (Vite)
- `Dockerfile`: build multi-stage del client e runtime unico Node.js
- `docker-compose.yml`: avvio del servizio unico
- `deploy.sh`, `run.sh`, `localrun.sh`: script di supporto Docker e sviluppo locale

## Requisiti (run locale senza Docker)

- Node.js 18+
- Un volume montato sul filesystem (es. `/mnt/data`)

## Configurazione

Variabili principali:

- `VOLUME_ROOT`: path assoluto del volume montato
- `PORT`: porta del servizio finale (`8080` nel container, `4000` in dev server locale)
- `APP_BASE`: base path della SPA servita dal backend
- `CORS_ORIGIN`: origin del frontend in sviluppo locale
- `MAX_EDITABLE_BYTES`: limite per editor testo
- `MAX_FILE_CONTENT_BYTES`: limite massimo per lettura/scrittura contenuti testuali via API (`/api/file-content`); se non impostato usa `MAX_EDITABLE_BYTES`
- `MAX_BINARY_FILE_BYTES`: limite massimo upload/salvataggio binario (`/api/upload`, `/api/file-content`), default `52428800` (50MB)
- `OAUTH_ISSUER`: issuer OAuth/OIDC usato dal backend per validare i bearer token (`GET /me`)
- `TOKEN_VALIDATION_CACHE_TTL_MS`: cache token lato backend (ms) per ridurre round-trip al provider
- `VITE_OAUTH_ISSUER`: issuer OAuth/OIDC usato dal frontend bundled (`authWidget.js`)
- `VITE_OAUTH_CLIENT_ID`: client id OAuth usato dal widget frontend (default `fileserver-web`)
- `VITE_OAUTH_SCOPE`: scope OAuth usati dal widget frontend
- `VITE_OAUTH_STORAGE_KEY`: chiave `sessionStorage` prioritaria per lettura token (default/fallback: `oauth-authWidget`)
- `VITE_OAUTH_COMPONENT_URL`: URL del bundle React auth (default `${VITE_OAUTH_ISSUER}/app/assets/authWidget.js`)

## Avvio locale (senza Docker)

```bash
./localrun.sh
```

Apri: `http://localhost:5173`

## Avvio con Docker Compose

```bash
docker compose up --build
```

Servizio unico: `http://localhost:8080`

Il volume dati locale viene montato da `./data/files` a `/data` nel container. L'accesso API e' protetto da bearer token OAuth: se non autenticato il frontend mostra solo la schermata login.
I file sono isolati per utente autenticato: ogni utente vede e modifica solo `VOLUME_ROOT/<username>/**`.

Il container gira come utente non-root con UID/GID `1000:1000`. La directory host `./data/files` deve quindi essere scrivibile da `1000:1000`.

Esempio preparazione directory host:

```bash
mkdir -p ./data/files
sudo chown -R 1000:1000 ./data/files
chmod 775 ./data/files
```

Libreria browser cross-site:

- asset: `http://localhost:8080/assets/api.js`
- esempio completo: `http://localhost:8080/example.html`
- globale esposta: `window.FileserverApi`
- factory: `window.FileserverApi.createClient({ apiBase: 'http://localhost:8080/api' })`

## Integrazione Web

### Caricamento libreria

```html
<script src="http://localhost:8080/assets/api.js"></script>
<script>
  const client = window.FileserverApi.createClient({
    apiBase: 'http://localhost:8080/api',
    getAccessToken: () => sessionStorage.getItem('my-token')
  });
</script>
```

### Esempio iniziale

```html
<script src="http://localhost:8080/assets/api.js"></script>
<script>
  const client = window.FileserverApi.createClient({
    apiBase: 'http://localhost:8080/api',
    getAccessToken: () => sessionStorage.getItem('my-token')
  });

  client.listDirectory('').then((result) => {
    console.log('Root:', result);
  });
</script>
```

### API JavaScript disponibili

#### `listDirectory(relativePath)`

Lista file e cartelle della directory richiesta.

```js
client.listDirectory('documenti').then(console.log);
```

#### `createFolder(path, name)`

Crea una cartella sotto il path indicato.

```js
client.createFolder('documenti', 'nuova-cartella').then(console.log);
```

#### `uploadFiles(path, files, onProgress)`

Carica uno o piu file con callback di avanzamento.

```html
<input id="files" type="file" multiple />
<script>
  const input = document.getElementById('files');

  input.addEventListener('change', async () => {
    await client.uploadFiles('upload', input.files, (progress) => {
      console.log('progress', progress);
    });
  });
</script>
```

#### `deleteItem(path)`

Elimina file o cartella.

```js
client.deleteItem('documenti/vecchio.txt').then(console.log);
```

#### `renameItem(path, newName)`

Rinomina un file o una cartella.

```js
client.renameItem('documenti/bozza.txt', 'finale.txt').then(console.log);
```

#### `downloadFile(path)`

Scarica un file e restituisce `blob` e `filename`.

```js
client.downloadFile('documenti/report.pdf').then(({ blob, filename }) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
});
```

#### `loadRawFileBlob(path)`

Legge il contenuto raw di un file per preview o embedding.

```js
client.loadRawFileBlob('immagini/foto.jpg').then(({ blob, contentType }) => {
  console.log(contentType, blob);
});
```

#### `createArchive(paths, archiveName)`

Crea uno ZIP di file e cartelle.

```js
client.createArchive(
  ['documenti', 'note/todo.txt'],
  'backup.zip'
).then(({ blob, filename }) => {
  console.log(filename, blob);
});
```

#### `loadFileContent(path)`

Legge il contenuto testuale di un file.

```js
client.loadFileContent('documenti/appunti.txt').then(console.log);
```

#### `saveFileContent(path, content)`

Salva il contenuto testuale di un file esistente.

```js
client.saveFileContent('documenti/appunti.txt', 'contenuto aggiornato').then(console.log);
```

#### `printPdf(html, filename)`

Genera un PDF a partire da un documento HTML. Il rendering usa media print e applica CSS interni, `@page`, `@media print`, font e formati pagina definiti nel markup.

```js
client.printPdf(`
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: A4; margin: 12mm; }
        @media print {
          body { font-family: serif; }
        }
        h1 { color: #1f4b99; }
      </style>
    </head>
    <body>
      <h1>Report</h1>
      <p>PDF generato dal servizio.</p>
    </body>
  </html>
`, 'report.pdf').then(({ blob, filename }) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
});
```

### Note integrazione

- La libreria e' servita da `GET /assets/api.js`.
- L'asset viene esposto con `Access-Control-Allow-Origin: *`.
- Le API usano base configurabile tramite `createClient({ apiBase })`.
- Le operazioni `downloadFile`, `loadRawFileBlob`, `createArchive` e `printPdf` restituiscono `Blob`.

## API principali

- `GET /api/list?path=`
- `POST /api/upload` (multipart field: `files`, body field: `path`)
- `GET /api/download?path=`
- `GET /api/raw?path=` (anteprima inline)
- `POST /api/archive` (zip di file/cartelle)
- `DELETE /api/item?path=`
- `PATCH /api/rename`
- `POST /api/folder`
- `GET /api/file-content?path=`
- `PUT /api/file-content`
- `POST /api/print-pdf`

Tutte le API richiedono `Authorization: Bearer <access_token>`.
Le operazioni di caricamento/salvataggio file usano payload binario con limite 50MB (configurabile via `MAX_BINARY_FILE_BYTES`).

## Note di sicurezza

- Le path richieste dal client sono validate lato server.
- Qualsiasi tentativo di uscire da `VOLUME_ROOT` viene bloccato.
- La root del volume non può essere eliminata.
