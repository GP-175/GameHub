# GameHub

GameHub is the main web app for kid-friendly learning games and GP-hoot.

## Environments

### Production
- Main site: `https://gplange.tech`, served by Vercel from the committed `vercel.json` configuration.
- Approved changes merged/pushed to `main` trigger the existing signed GitHub webhook on this host. The deployment pipeline backs up runtime data, updates the persistent VPS backend, runs tests, and invokes `bash scripts/deploy-vercel-production.sh` to publish the domain.
- Vercel receives only the browser app built into `public/` by `npm run build:vercel`. `/api/*` and uploads proxy to the existing `gp-hoot.gplange.tech` backend; GP-hoot itself redirects there for long-lived realtime support.
- The Vercel project is `gamehub`. Its native Git connection is currently unavailable to the authenticated account, so automatic production uses the existing main webhook rather than a Vercel Git integration.
- The host must retain its authenticated Vercel CLI credentials and `/srv/gamehub/.vercel/project.json`. No tokens are committed or sent to GitHub. The production script verifies exact domain content and the state API before recording `.vercel/production-sha` and reporting success.
- Production deploys should only happen from `main` after testing is approved.
- Recovery/redeploy: run `FORCE_DEPLOY=1 /home/Porgy/.openclaw/workspace/bin/deploy-gamehub.sh` on the deployment host; see its log at `/home/Porgy/.openclaw/workspace/logs/gamehub-deploy.log`. If Vercel auth expires or is revoked, authenticate with `npx --yes vercel@62.2.0 login`.

### Preview / Preprod
GameHub has a branch-based preview workflow and it should be treated as the default **preprod** path before merging to `main`.

Run this from the server:

```bash
cd /srv/gamehub
scripts/deploy-preview.sh <branch-name>
```

Example:

```bash
scripts/deploy-preview.sh claude/quirky-mendeleev-aaaf75
```

That workflow:
- fetches the target branch
- creates a temporary worktree
- applies preview-only Vercel shims automatically
- runs `npm install` and `npm test`
- deploys a Vercel Preview URL

More detail:
- `docs/preview-workflow.md`

## Release rule

Use the preview/preprod flow first.
Only merge to `main` and deploy production after preview approval.

## Caveat

The preview flow is strong for UI, route, and basic API verification, but it is not a perfect production twin for durable storage or long-lived realtime/socket behavior.
