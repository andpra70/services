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
- `CORS_ORIGIN`: origin consentite CORS (singola origin, lista separata da virgole, oppure `*`)
- `MAX_EDITABLE_BYTES`: limite per editor testo
- `MAX_FILE_CONTENT_BYTES`: limite massimo per lettura/scrittura contenuti testuali via API (`/api/file-content`); se non impostato usa `MAX_EDITABLE_BYTES`
- `MAX_BINARY_FILE_BYTES`: limite massimo upload/salvataggio binario (`/api/upload`, `/api/file-content`), default `52428800` (50MB)
- `OAUTH_ISSUER`: issuer OAuth/OIDC usato dal backend per validare i bearer token (`GET /me`)
- `OAUTH_ALLOW_SELF_SIGNED_TLS`: se `true`, disabilita la verifica certificati TLS per chiamate HTTPS outbound del backend (solo dev/troubleshooting)
- `TOKEN_VALIDATION_CACHE_TTL_MS`: cache token lato backend (ms) per ridurre round-trip al provider
- `TOKEN_VALIDATION_TIMEOUT_MS`: timeout chiamata backend -> `${OAUTH_ISSUER}/me` (ms)
- `TOKEN_VALIDATION_RETRY_ATTEMPTS`: tentativi massimi per validazione token in caso di errore rete/DNS transiente (`EAI_AGAIN`)
- `TOKEN_VALIDATION_RETRY_DELAY_MS`: attesa tra retry validazione token (ms)
- `VITE_OAUTH_ISSUER`: issuer OAuth/OIDC usato dal frontend bundled (`authWidget.js`)
- `VITE_OAUTH_CLIENT_ID`: client id OAuth usato dal widget frontend (default `fileserver-web`)
- `VITE_OAUTH_SCOPE`: scope OAuth usati dal widget frontend
- `VITE_OAUTH_STORAGE_KEY`: chiave `sessionStorage` prioritaria per lettura token (default/fallback: `oauth-authWidget`)
- `VITE_OAUTH_COMPONENT_URL`: URL del bundle React auth (default `${VITE_OAUTH_ISSUER}/app/assets/authWidget.js`)
- `VITE_OAUTH_REDIRECT_URI`: redirect URI esplicita usata dal widget (`redirect_uri` + `post_logout_redirect_uri`); default runtime `${window.location.origin}${window.location.pathname}`

Context base applicazione: `APP_BASE=/fileserver/` (frontend + backend).

Script con file env:
- `./localrun.sh` carica `${PWD}/.env` (override con `ENV_FILE=/path/to/file`)
- `./deploy.sh` carica `${PWD}/.env.prod` (override con `ENV_FILE=/path/to/file`)
- `./run.sh` carica `${PWD}/.env.prod` (override con `ENV_FILE=/path/to/file`)

Per build/deploy Docker, le variabili `VITE_*` sono lette in fase di build immagine (non a runtime). Se `VITE_OAUTH_ISSUER` non e' valorizzata, il frontend usa fallback runtime:
- host locale (`localhost/127.0.0.1`): `http://localhost:9000`
- host non locale (es. reverse proxy): `${window.location.origin}/oauth-server`

Se in produzione `VITE_OAUTH_COMPONENT_URL` o `VITE_OAUTH_ISSUER` puntano a `localhost`, il frontend li ignora e usa il fallback runtime su `${window.location.origin}/oauth-server`.

Importante: il backend valida i bearer token su `${OAUTH_ISSUER}/me` a runtime. In produzione `OAUTH_ISSUER` deve puntare al provider pubblico (es. `https://zanotti.iliadboxos.it:55443/oauth-server`), non a `localhost`.

Deploy prod:

```bash
./deploy.sh
```

## Avvio locale (senza Docker)

```bash
./localrun.sh
```

Apri: `http://localhost:5173/fileserver/`

## Avvio con Docker Compose

```bash
docker compose up --build
```

Servizio unico: `http://localhost:8080/fileserver/`

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
- `GET /api/download/*` (download pubblico read-only senza bearer)
- `GET /api/raw?path=` (anteprima inline)
- `POST /api/archive` (zip di file/cartelle)
- `DELETE /api/item?path=`
- `PATCH /api/rename`
- `POST /api/folder`
- `GET /api/file-content?path=`
- `PUT /api/file-content`
- `POST /api/print-pdf`

Tutte le API `/api/*` richiedono `Authorization: Bearer <access_token>`, tranne `GET /api/download/*` che e' pubblico.
Le operazioni di caricamento/salvataggio file usano payload binario con limite 50MB (configurabile via `MAX_BINARY_FILE_BYTES`).

## Script Bash + curl (auth, list, upload, download)

E' disponibile lo script `scripts/curl-auth-file-flow.sh` che esegue in sequenza:

1. autenticazione OAuth (`POST ${OAUTH_ISSUER}/token`)
2. lista file autenticata (`GET /api/list`)
3. upload file autenticato (`POST /api/upload`)
4. download autenticato dello stesso file (`GET /api/download?path=...`)
5. download pubblico dello stesso file senza token (`GET /api/download/<username>/<path>`)

Esempio:

```bash
FILESERVER_BASE_URL="http://localhost:8080" \
OAUTH_ISSUER="http://localhost:9000" \
TOKEN_FORM='grant_type=password&client_id=fileserver-web&username=demo&password=demo&scope=openid%20profile%20email' \
./scripts/curl-auth-file-flow.sh ./README.md
```

Variabili principali dello script:

- `TOKEN_FORM`: body `application/x-www-form-urlencoded` usato per ottenere `access_token` (adatta grant/client/credenziali al tuo provider)
- `ACCESS_TOKEN`: se valorizzato, lo script salta `POST /token` e usa direttamente questo bearer token
- `TARGET_DIR`: cartella di destinazione nel fileserver (default root utente)
- `SOURCE_FILE`: file locale da caricare (in alternativa primo argomento script)
- `UPLOAD_FILENAME`: nome remoto del file caricato
- `OUTPUT_DIR`: cartella locale dove salvare i download di test
- `ALLOW_SELF_SIGNED_TLS`: default `1`; usa `--insecure` nelle curl dello script per ignorare certificati self-signed (`0` per riabilitare verifica TLS)

## Script Node.js semplice (stesso flusso)

E' disponibile anche la versione Node.js minimale: `scripts/node-auth-file-flow.mjs`.

Esempio:

```bash
FILESERVER_BASE_URL="http://localhost:8080" \
OAUTH_ISSUER="http://localhost:9000" \
TOKEN_FORM='grant_type=password&client_id=fileserver-web&username=demo&password=demo&scope=openid%20profile%20email' \
node ./scripts/node-auth-file-flow.mjs ./README.md
```

Variabili principali: stesse della versione bash (`TOKEN_FORM`, `ACCESS_TOKEN`, `TARGET_DIR`, `SOURCE_FILE`, `UPLOAD_FILENAME`, `OUTPUT_DIR`, `TOKEN_URL`, `ME_URL`, `ALLOW_SELF_SIGNED_TLS`). Con `ALLOW_SELF_SIGNED_TLS=1` (default) imposta `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Curl manuali equivalenti

Autenticazione:

```bash
curl -X POST "http://localhost:9000/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data 'grant_type=password&client_id=fileserver-web&username=demo&password=demo&scope=openid%20profile%20email'
```

Lista file autenticata:

```bash
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8080/api/list?path="
```

Upload autenticato:

```bash
curl -X POST "http://localhost:8080/api/upload" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -F "path=" \
  -F "files=@./README.md;filename=README.md"
```

Download autenticato:

```bash
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8080/api/download?path=README.md" \
  -o ./download-auth-README.md
```

Download senza autenticazione dello stesso file (path pubblico):

```bash
curl "http://localhost:8080/api/download/<username_sanitizzato>/README.md" \
  -o ./download-public-README.md
```

`<username_sanitizzato>` e' il nome utente derivato dalle claim OAuth (`preferred_username`, `username`, `email`, `sub`) con caratteri non consentiti sostituiti da `_`.

## Note di sicurezza

- Le path richieste dal client sono validate lato server.
- Qualsiasi tentativo di uscire da `VOLUME_ROOT` viene bloccato.
- La root del volume non può essere eliminata.
