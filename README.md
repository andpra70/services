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
