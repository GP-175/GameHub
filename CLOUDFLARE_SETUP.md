# Gamehub Cloudflare setup for shared persistence

The Gamehub app now includes a Worker API layer for shared state sync:
- `GET /api/state?user=<key>`
- `POST /api/state`

It expects a Cloudflare KV binding:
- `GAMEHUB_STATE`

## Current blocker
`wrangler.jsonc` still contains a placeholder KV id:
- `REPLACE_WITH_REAL_KV_ID`

You need to create a real KV namespace and place its id into `wrangler.jsonc`.

## Prerequisites
Set a Cloudflare API token in your shell before running Wrangler commands:

```bash
export CLOUDFLARE_API_TOKEN="YOUR_TOKEN_HERE"
```

The token should have permissions sufficient for Workers and KV namespace management.

## 1. Create the KV namespace
Run this in `/srv/gamehub`:

```bash
cd /srv/gamehub
npx wrangler kv namespace create GAMEHUB_STATE
```

If you use a preview environment too, also run:

```bash
cd /srv/gamehub
npx wrangler kv namespace create GAMEHUB_STATE --preview
```

Wrangler will return namespace ids.

## 2. Update `wrangler.jsonc`
Replace:

```json
{ "binding": "GAMEHUB_STATE", "id": "REPLACE_WITH_REAL_KV_ID" }
```

with the real id, for example:

```json
{
  "binding": "GAMEHUB_STATE",
  "id": "abc123realnamespaceid",
  "preview_id": "preview456namespaceid"
}
```

If you only create one namespace, you can omit `preview_id`.

## 3. Deploy
Then deploy the Worker:

```bash
cd /srv/gamehub
npx wrangler deploy
```

## 4. Verify
After deploy, test the API:

### GET
```bash
curl "https://YOUR_GAMEHUB_DOMAIN/api/state?user=test-user"
```

Expected first response:
```json
{"user":"test-user","state":null}
```

### POST
```bash
curl -X POST "https://YOUR_GAMEHUB_DOMAIN/api/state" \
  -H "content-type: application/json" \
  -d '{"user":"test-user","state":{"hello":"world"}}'
```

Expected response:
```json
{"ok":true}
```

Then GET again and confirm the stored state returns.

## 5. Use it in the app
In Gamehub Parent view:
- open **Cloud sync**
- enter the same sync key in both browsers, for example `george-mba`
- click **Save sync key**
- use the app normally so state saves remotely
- in another browser, enter the same sync key and click **Pull remote state**

## Notes
- Current sync model is whole-state push/pull, not field-level merge
- Last write wins
- This is enough to make profiles, quiz progress, and mastery available across browsers
- Safer conflict handling can be added later if needed
