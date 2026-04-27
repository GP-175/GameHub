# GameHub

GameHub is the main web app for kid-friendly learning games and GP-hoot.

## Environments

### Production
- Main site: `https://gplange.tech`
- Production deploys should only happen from `main` after testing is approved.

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
