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

Il volume dati locale viene montato da `./data/files` a `/data` nel container. Non e' presente autenticazione: il frontend chiama direttamente le API esposte dallo stesso servizio.

Libreria browser cross-site:

- asset: `http://localhost:8080/assets/api.js`
- globale esposta: `window.FileserverApi`
- factory: `window.FileserverApi.createClient({ apiBase: 'http://localhost:8080/api' })`

## Integrazione Web

### Caricamento libreria

```html
<script src="http://localhost:8080/assets/api.js"></script>
<script>
  const client = window.FileserverApi.createClient({
    apiBase: 'http://localhost:8080/api'
  });
</script>
```

### Esempio iniziale

```html
<script src="http://localhost:8080/assets/api.js"></script>
<script>
  const client = window.FileserverApi.createClient({
    apiBase: 'http://localhost:8080/api'
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

### Note integrazione

- La libreria e' servita da `GET /assets/api.js`.
- L'asset viene esposto con `Access-Control-Allow-Origin: *`.
- Le API usano base configurabile tramite `createClient({ apiBase })`.
- Le operazioni `downloadFile`, `loadRawFileBlob` e `createArchive` restituiscono `Blob`.

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

## Note di sicurezza

- Le path richieste dal client sono validate lato server.
- Qualsiasi tentativo di uscire da `VOLUME_ROOT` viene bloccato.
- La root del volume non può essere eliminata.
