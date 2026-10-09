# Masarif list sharing

A small Cloudflare Worker that holds a shared grocery list while a shopkeeper fills it in, and serves the page the shopkeeper opens.

The Masarif app encrypts each list before uploading it. The key travels only in the part of the link after `#`, which browsers do not send to servers, so this service stores text it cannot read. Each list is deleted when its link expires (1, 6 or 24 hours) or when the owner ends it.

## What is here

| Path | Purpose |
|---|---|
| `src/worker.ts` | The API and the routing for the page |
| `public/list.html`, `list.css`, `list.js` | The shopkeeper's page (English and Urdu) |
| `schema.sql` | The two database tables |
| `wrangler.toml` | Cloudflare configuration |

## Deploy

You need a free Cloudflare account and Node.js.

1. Install and sign in:

   ```bash
   cd masarif-share
   npm install
   npx wrangler login
   ```

2. Create the database:

   ```bash
   npx wrangler d1 create masarif-share
   ```

   Copy the `database_id` it prints into `wrangler.toml`, replacing the row of zeros.

3. Create the tables and deploy:

   ```bash
   npm run db:remote
   npm run deploy
   ```

   The last command prints the address, for example `https://masarif-share.<your-name>.workers.dev`.

4. Put that address in `mobile/app.json` under `expo.extra.groceryShareUrl` (no trailing slash needed), then rebuild the app. Until this is set, the Share button in the app stays disabled.

To check the deployment, open the address in a browser. It should show "Masarif list sharing."

## Run locally

```bash
npm run db:local
npm run dev
```

The page needs a secure address to decrypt, so test it on `http://localhost:8787` in a desktop browser or on the deployed `https` address. A phone cannot use your computer's local address.

## API

All bodies are JSON. Blobs are base64url text of at most 64,000 characters.

| Route | Who | Notes |
|---|---|---|
| `POST /api/lists` | app | Body `{ id, ownerToken, ttlSeconds, list }`. `ttlSeconds` must be 3600, 21600 or 86400. Returns `{ id, expiresAt }` |
| `GET /api/lists/:id` | app and page | Returns `{ list, fill, listRev, fillRev, expiresAt }`, or 404 once expired |
| `PUT /api/lists/:id/list` | app | Needs `Authorization: Bearer <ownerToken>`. Body `{ list }` |
| `PUT /api/lists/:id/fill` | page | Body `{ fill }`. Anyone with the link can call this |
| `DELETE /api/lists/:id` | app | Needs the owner token |

## Limits and housekeeping

- From one network address: 120 new lists an hour and 300 changes a minute. Change `CREATES_PER_HOUR` and `WRITES_PER_MINUTE` in `src/worker.ts` if needed.
- A scheduled job deletes expired lists and old rate-limit counters once a day. Expired lists stop being served immediately, before that job runs.
- Network addresses are kept only as a hash inside a counter that lasts at most an hour.
