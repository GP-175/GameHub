#!/usr/bin/env bash
# Called by the main-branch deployment webhook after the VPS gates pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ "$(git branch --show-current)" != main ]; then
  printf '%s\n' 'Refusing production deployment outside main.' >&2
  exit 1
fi
if [ ! -f .vercel/project.json ]; then
  printf '%s\n' 'Missing linked Vercel project. Restore the existing gamehub project.json.' >&2
  exit 1
fi
SHA="$(git rev-parse HEAD)"
npx --yes vercel@62.2.0 deploy --prod --yes --meta "githubCommitSha=$SHA" --meta githubCommitRef=main
# Verify the actual domain serves this checkout, not only that the upload succeeded.
node --input-type=module <<'JS'
import fs from 'node:fs';
const files=['index.html','assets/hub.js','games/type-safari.html','assets/type-safari/app.js','assets/type-safari/hub-adapter.js','assets/type-safari/curriculum.js','assets/type-safari/hands.js','assets/type-safari/style.css','assets/type-safari/theme.css','assets/type-safari/hub.css','assets/type-safari/hand-position.png','sw.js'];
for(const file of files){
 const r=await fetch('https://gplange.tech/'+file,{signal:AbortSignal.timeout(30000),cache:'no-store'});
 if(!r.ok||!Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(file)))throw Error('Production content mismatch: '+file);
}
const r=await fetch('https://gplange.tech/api/state',{signal:AbortSignal.timeout(30000),cache:'no-store'});
if(!r.ok||!('revision' in await r.json()))throw Error('Production state API unavailable');
console.log(`Verified production domain: ${files.length} exact files and durable state API.`);
JS
printf '%s\n' "$SHA" > .vercel/production-sha.pending
mv .vercel/production-sha.pending .vercel/production-sha
