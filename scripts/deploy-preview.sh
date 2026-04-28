#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="${1:-$(git -C "$REPO_ROOT" branch --show-current)}"
SAFE_BRANCH="$(printf '%s' "$BRANCH" | tr '/:' '--' | tr -cd 'a-zA-Z0-9._-')"
PREVIEW_ROOT="${GAMEHUB_PREVIEW_ROOT:-$HOME/.openclaw/workspace/tmp/gamehub-preview-$SAFE_BRANCH}"

if [[ -z "$BRANCH" ]]; then
  echo "Could not determine a branch. Pass one explicitly, e.g. scripts/deploy-preview.sh feature/my-branch" >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/.vercel/project.json" ]]; then
  echo "Missing $REPO_ROOT/.vercel/project.json. Link the repo to Vercel on this server first." >&2
  exit 1
fi

echo "==> Preparing preview for branch: $BRANCH"
echo "==> Working checkout: $PREVIEW_ROOT"

git -C "$REPO_ROOT" fetch origin "$BRANCH"
if [[ -e "$PREVIEW_ROOT" ]]; then
  git -C "$REPO_ROOT" worktree remove --force "$PREVIEW_ROOT" 2>/dev/null || rm -rf "$PREVIEW_ROOT"
fi

git -C "$REPO_ROOT" worktree add --force "$PREVIEW_ROOT" "origin/$BRANCH"
mkdir -p "$PREVIEW_ROOT/.vercel"
cp "$REPO_ROOT/.vercel/project.json" "$PREVIEW_ROOT/.vercel/project.json"
node "$REPO_ROOT/scripts/prepare-preview-checkout.mjs" "$PREVIEW_ROOT"

echo "==> Running tests"
(
  cd "$PREVIEW_ROOT"
  npm install
  npm test
)

echo "==> Deploying preview"
deploy_output="$(
  cd "$PREVIEW_ROOT"
  vercel deploy --yes 2>&1
)"
printf '%s\n' "$deploy_output"

deployment_url="$(printf '%s\n' "$deploy_output" | grep -Eo 'https://[^[:space:]]+\.vercel\.app' | head -n 1 || true)"

if [[ -n "$deployment_url" ]]; then
  inspect_output="$(vercel inspect "${deployment_url#https://}" 2>&1 || true)"
  mapfile -t alias_urls < <(printf '%s\n' "$inspect_output" | grep -Eo 'https://[^[:space:]]+\.vercel\.app' | grep -v "${deployment_url#https://}" | awk '!seen[$0]++')

  if (( ${#alias_urls[@]} > 0 )); then
    echo
    echo "==> Stable preview / staging target(s)"
    for alias_url in "${alias_urls[@]}"; do
      echo "$alias_url"
    done
  fi
fi
