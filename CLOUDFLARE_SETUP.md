# Gamehub shared persistence setup

The Gamehub app now includes a shared state sync API:
- `GET /api/state?user=<key>`
- `POST /api/state`

It supports two backends:
1. **Local file storage**, works now on the local machine
2. **Cloudflare KV**, optional later

## Local mode, works now
If you run Gamehub locally with the Worker/server entrypoint, state can be stored in:
- `/srv/gamehub/.data/<sync-key>.json`

That means multiple browsers can share the same data on the same machine if they use the same sync key.

### How to use local mode
In Gamehub Parent view:
- open **Cloud sync**
- enter the same sync key in both browsers, for example `george-mba`
- click **Save sync key**
- use the app in one browser so it saves state
- in the other browser click **Pull remote state**

### Local storage path
Shared state files are written to:

```bash
/srv/gamehub/.data/
```

Each key becomes a JSON file, for example:

```bash
/srv/gamehub/.data/george-mba.json
```

## Cloudflare mode, optional later
The same API can also use a KV binding:
- `GAMEHUB_STATE`

### Current blocker
`wrangler.jsonc` still contains a placeholder KV id:
- `REPLACE_WITH_REAL_KV_ID`

You only need to change that when you decide to move to Cloudflare-backed persistence.

### Cloudflare steps later
```bash
export CLOUDFLARE_API_TOKEN="YOUR_TOKEN_HERE"
cd /srv/gamehub
npx wrangler kv namespace create GAMEHUB_STATE
npx wrangler kv namespace create GAMEHUB_STATE --preview
```

Then update `wrangler.jsonc` with the real ids and deploy.

## Notes
- Current sync model is whole-state push/pull, not field-level merge
- Last write wins
- This is enough to make profiles, quiz progress, and mastery available across browsers
- Safer conflict handling can be added later if needed
