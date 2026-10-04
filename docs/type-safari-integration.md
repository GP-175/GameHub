# Native Type Safari integration

## Fit and design

Type Safari belongs in GameHub as a **Typing** activity, rather than a second family application. It is registered for `early-elem` and `adult`, not toddler. A physical-keyboard notice appears both on its library card and inside the activity. Existing registry-driven search, subject tabs, library, age-default controls, per-profile parent toggles, recent activity, and dashboard summaries work without special-case parent/index code.

The entry point is `games/type-safari.html`. GameHub branding, shared light/dark theme (`gamehub.theme`), active profile label, Parent zone, and obvious All games/Back to GameHub links surround the learning experience. Safari's Learn, Hand placement, Practice, Progress, and Badges navigation remains because those views are useful inside a substantial 16-lesson activity. There is no iframe, separate sign-in, profile switcher, account toolbar, downloadable offline application, fetch interception, or standalone database.

## Learning and persistence

- Original 16 lessons and four worlds retained, including three practice rounds then three consecutive checks, original accuracy/WPM targets, failed-check refresher/reset, replay, badges, streaks, XP, and adaptive weak-key practice.
- Curriculum, animated helping hands, and instructional hand-position image are byte-identical to upstream. No standalone distribution/backend files were copied. Unused family/account CSS, external font imports, and the unused 2.9 MB hero image were omitted.
- `hub-adapter.js` reads profile-scoped `Hub.getGameConfig(profileId, 'type-safari')`. The config contains `typingProgress` and `preferences`; preference writes merge existing config and nested preferences through `Hub.setGameConfig`.
- Each round calls `Hub.startSession`. Finished attempts are validated/scored with the original curriculum, then recorded with `Hub.recordPlay` using explicit profile ownership and an attempt ID.
- A backwards-compatible optional `recordPlay` payload commits detailed typing progress and the parent dashboard counter in **one localStorage write**. Storage failure rolls both back. Retries deduplicate IDs and preserve the original duration. Three-argument callers and `endSession` retain their behavior.
- Missing/deleted/disabled profiles are guarded, including direct URLs. Typing, saves, and preference writes reject a changed profile. The UI closes/guards a round after background-sync or cross-tab profile changes instead of saving to another learner.
- Only the existing `/api/state` sync is used; no `/api/progress` or `/api/session` routes were added or claimed.

## Necessary shared-data fixes

Real browser testing found an existing Hub race: immediately returning to Hub/refreshing before the 400 ms sync debounce could let an older remote snapshot erase a new round or profile selection. Hub now persists a local-pending token, protects it during hydration/background pulls, requeues it after reload/reconnect (including an empty remote), serializes pushes, and never lets an old acknowledgement overwrite newer local changes. A genuinely divergent remote revision is reported as a conflict while retaining local data, not silently overwritten. Regression tests cover these cases.

The upstream hand-guide animation also had a close-before-animation-frame null dereference; queued hand redraws now check that the lesson is still open when the callback executes.

## Offline

The existing service-worker cache is bumped from `gamehub-v34` to `gamehub-v36`. The activity HTML, Hub dependency, all imported modules, all three activity stylesheets, and the hand-position image are cached. There are no activity CDN/font dependencies. The browser smoke verifies actual cache entries, offline refresh, completion of a personal practice round offline, another offline refresh, and reconnection persistence through the existing state API.

## Verification

From the feature checkout, after `npm ci --ignore-scripts`:

```sh
npm test
npm run build
node --check assets/hub.js
node --check sw.js
node --check assets/type-safari/app.js
node --check assets/type-safari/hub-adapter.js
node --check assets/type-safari/curriculum.js
node --check assets/type-safari/hands.js
node --check scripts/smoke-type-safari.cjs
npm run test:type-safari:browser -- /path/to/scratch/results
git diff --check
```

Final verification: `npm test` passed **18/18 tests**; build, JavaScript syntax checks, and `git diff --check` passed. The production-server Chromium smoke passed **24/24 assertions**, with eight screenshots and zero uncaught browser exceptions. One earlier full-suite run concurrent with Chromium timed out in the unchanged GP-hoot socket-flow test; the subsequent standalone full-suite run passed. No unrelated GP-hoot test/server code was changed.

The browser test requires Linux, Node >=22, Chromium (`CHROME_BIN` overrides `/usr/bin/chromium`), installed project dependencies, and `TMPDIR` pointing to scratch. It uses built-in CDP/WebSocket support, so no Playwright dependency is added. It copies the **real production server and static files** into scratch, chooses a free port, uses isolated database/uploads/browser state, and cleans up its test processes/data. A Linux inherited-directory fd alias avoids Express `sendFile` rejecting the `.hermes` ancestor of scratch; server source is unchanged. No deployed service or live family state is accessed.

Automated coverage includes all 96 required rounds across the complete trail, mastery/refresher rules, adaptive weak keys, invalid/stale/incomplete rounds, idempotent saves, storage rollback, non-destructive preferences, profile isolation/guards, legacy Hub recording, dirty-state hydration/acknowledgement/reconnect races, and complete offline asset coverage.

The real Chromium smoke has **24 assertions**: physical key-event completion, forced storage failure and retry, immediate refresh, profile isolation and mid-round switching, shared theme/return navigation, search and Typing tab, actual parent toggles and dashboard attempt, cached dependencies, offline completion/refresh/reconnect, narrow layout, and zero uncaught browser exceptions. Automated typing speed in screenshots is not a human WPM measurement.

Final evidence is recorded outside the repository at:

- `/home/Porgy/.hermes/cache/scratch/type-safari-integration/smoke-final/smoke-results.json`
- Screenshots in the same directory: `safari-trail-light.png`, `safari-hands-and-lesson.png`, `safari-round-complete.png`, `safari-progress-light.png`, `safari-progress-dark.png`, `hub-typing-filter-dark.png`, `parent-safari-progress.png`, and `safari-mobile.png`.

## Limits and review notes

- Browser verification covers Chromium desktop and a 390 px narrow viewport, not Safari/iOS or a real hardware keyboard/tablet. A physical keyboard is recommended; the upstream lesson input blocks paste/multi-character input intentionally.
- Existing shared-state revision conflicts are retained/reported, not automatically merged across devices. This integration does not redesign GameHub's family-wide sync/authentication model or import existing standalone Safari accounts/progress.
- `npm audit` reports seven existing dependency advisories (one low, three moderate, three high); no dependency upgrades were made as part of this feature.
- Upstream has no declared license; see `assets/type-safari/NOTICE.md` before any public redistribution.
- This is a committed review branch only. Nothing is pushed or deployed, and `/srv/gamehub`/`gamehub-local` are unchanged.
