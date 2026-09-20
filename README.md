# Fileserver VFS2

Interfaccia web React per consultare e gestire i file salvati su VFS2.

Il progetto non contiene un backend applicativo proprio: autenticazione, lista,
upload, creazione cartelle e download sono forniti rispettivamente dai widget
condivisi `/auth/widget.js` e `/vfs/widget.js` esposti dal front controller.

## Struttura

- `client/`: applicazione React/Vite.
- `client/src/api.js`: adapter OAuth2/VFS2.
- `client/src/models.js`: normalizzazione dei modelli VFS2.
- `nginx.conf`: server statico di produzione non-root.
- `Dockerfile`: build Vite multi-stage e runtime nginx.

La cartella `data/` contiene esclusivamente dati legacy locali e non viene più
montata, copiata nell'immagine o utilizzata dall'applicazione.

## Sviluppo locale

Il front controller con OAuth2 e VFS2 deve essere disponibile su
`https://localhost`.

```bash
./localrun.sh
```

Aprire `http://localhost:5173/fileserver/`. Il dev server inoltra `/auth` e
`/vfs` al front controller. È possibile cambiare destinazione con
`VITE_FRONT_CONTROLLER_URL`.

## Docker

```bash
docker compose up --build
```

L'applicazione è disponibile su `http://localhost:8080`. Nel deployment completo
viene pubblicata dal front controller sotto `/fileserver/`.

## Immagine

L'immagine predefinita è `docker.io/andpra70/fileserver:latest`.

```bash
./deploy.sh
./run.sh
```
