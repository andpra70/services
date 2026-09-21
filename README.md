# Fileserver VFS2

Servizio unico per interfaccia React, widget VFS2 e API dei file su MinIO.
Verifica i JWT RS256 emessi da `oauth-server`, usa Redis per revoche e cache e
isola gli oggetti MinIO tramite il claim utente `sub`.

## Endpoint

- `GET /`: applicazione React compilata;
- `GET /widget.js`: widget globale `window.VfsWidget`;
- `GET /healthz`: stato del servizio;
- `GET /api/list`;
- `POST /api/upload`;
- `POST /api/mkdir`;
- `POST /api/rename`;
- `GET /api/download`;
- `DELETE /api/file`;
- `DELETE /api/rmdir`.
- `POST /api/publish`, copia ricorsivamente una directory privata in un percorso pubblico;
- `DELETE /api/public`, ritira una pubblicazione posseduta dall'utente;
- `GET /public/*`, legge i file pubblicati senza autenticazione.

Il front controller pubblica questi endpoint come `/fileserver/`,
`/vfs/widget.js` e `/vfs/api/*`. Le applicazioni continuano quindi a caricare:

```text
/auth/widget.js
/vfs/widget.js
```

Il widget mantiene le API VFS2 esistenti e aggiunge un file explorer React
incorporabile, isolato dagli stili della SPA tramite Shadow DOM:

```js
const file = await VfsWidget.open("private:catalogo-opere/images");
const directory = await VfsWidget.open("public:galleria", { mode: "directory" });
const target = await VfsWidget.open("minicms/sites", {
  mode: "save",
  suggestedName: "site.json",
  accept: [".json"],
});
```

`open()` senza percorso mostra la root virtuale con i volumi disponibili.
Il volume privato compare quando esiste una sessione OAuth; quello pubblico è
sempre consultabile e rimane in sola lettura. La chiusura restituisce `null`.

L'ultima directory aperta viene conservata in `localStorage`: alle aperture
successive, anche dopo il riavvio del browser, `open()` senza argomenti riparte
da volume e path precedenti. Un percorso passato esplicitamente ha sempre la
precedenza. La chiave predefinita è `vfs.explorer.location.v1` e può essere
personalizzata impostando `window.VFS_EXPLORER_STORAGE_KEY` prima del widget.

Nel volume privato è possibile trascinare uno o più file sulla directory
corrente per caricarli; al termine il listing viene aggiornato automaticamente.
Il drag-and-drop rimane disabilitato nel volume pubblico in sola lettura.

## Configurazione

| Variabile | Significato |
| --- | --- |
| `PORT` | Porta HTTP, predefinita `8080`. |
| `REDIS_URL` | Redis condiviso per cache e revoche. |
| `S3_ENDPOINT` | Endpoint interno MinIO. |
| `S3_REGION` | Regione S3. |
| `S3_BUCKET` | Bucket degli oggetti. |
| `S3_PUBLIC_BUCKET` | Bucket separato degli snapshot pubblici. |
| `S3_ACCESS_KEY` | Utente MinIO. |
| `S3_SECRET_KEY` | Password MinIO. |
| `JWT_ISSUER` | Issuer atteso nei token. |
| `JWT_AUDIENCE` | Audience attesa nei token. |
| `PUBLIC_KEY_PATH` | Chiave pubblica RS256 montata in runtime. |
| `ALLOWED_ORIGINS` | Origin CORS separate da virgola. |
| `MAX_UPLOAD_BYTES` | Dimensione massima di un upload. |

La chiave `keys/public.pem` non è versionata e deve corrispondere alla chiave
privata montata in `oauth-server`.

## Docker

La configurazione standalone include fileserver, Redis, MinIO e inizializzazione
del bucket:

```bash
docker compose up --build
```

L'immagine usa un runtime Node di produzione con utente non-root ed è pubblicata
come `docker.io/andpra70/fileserver`.

## Sviluppo locale

Impostare Redis, MinIO e relative credenziali, quindi:

```bash
./localrun.sh
```

Il backend parte normalmente sulla porta `8080` e Vite sulla porta `5173`.
Il login continua a essere fornito da `/auth/widget.js` tramite il front
controller configurato con `VITE_FRONT_CONTROLLER_URL`.
