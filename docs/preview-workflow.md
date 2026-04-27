# GameHub Preview Workflow

Use this when you want a branch-based preview before touching `main`.

## What this gives you

- a repeatable **branch -> tested preview deploy** flow
- branch changes deployed to the existing Vercel `gamehub` project as a **Preview** deployment
- preview-only fixes applied automatically so testing is closer to real usage

The workflow does **not** change `main` and does **not** push preview-only deploy shims back into git.

## Command

From `/srv/gamehub`:

```bash
scripts/deploy-preview.sh <branch-name>
```

Example:

```bash
cd /srv/gamehub
scripts/deploy-preview.sh claude/quirky-mendeleev-aaaf75
```

If you omit the branch name, the script uses the current local branch.

## What the script does

1. fetches the branch from `origin`
2. creates a temporary git worktree checkout
3. injects preview-only Vercel scaffolding:
   - `api/index.js` wrapper
   - generated `vercel.json`
   - preview runtime paths under `/tmp`
   - local preview GP-hoot routing
   - disables flaky preview remote-sync behavior on `.vercel.app`
4. runs:
   - `npm install`
   - `npm test`
5. deploys with:
   - `vercel deploy --yes`

## Important caveats

This is a strong **preprod UI / route / API preview**, but it is still not a perfect production twin.

Still weaker than VPS prod for:

- durable filesystem-backed state
- long-lived realtime/socket behavior
- anything that depends on always-on backend runtime

So the recommended release flow is:

1. build on feature branch
2. deploy preview with `scripts/deploy-preview.sh`
3. test and approve there
4. merge to `main`
5. let normal production deploy happen only after approval

## Requirements on this server

These must already exist:

- `/srv/gamehub/.vercel/project.json`
- `vercel` CLI authenticated
- `~/bin` on PATH or available via the script

## Cleanup / notes

- preview worktrees are created under:
  - `~/.openclaw/workspace/tmp/gamehub-preview-<branch>`
- rerunning the script for the same branch replaces the old worktree automatically
- Vercel will create a fresh Preview deployment URL each time

## Optional future upgrade

If we want a more production-like preprod later, add a **VPS-backed staging hostname** for GP-hoot and other persistent backend flows.
