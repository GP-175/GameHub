# Name Detective (preview)

An anonymous, tablet-first early-elementary activity about common nouns, proper nouns, and capitals. No typing, timer, login, analytics, or automatic progress integration.

## Learning path

- Model `cat` (general name) versus `Luna` (one cat's name); explain nouns and capitals, including capitals at sentence starts.
- Explicit independent or adult-guided choice. Guided answers are assisted throughout, including the exit check.
- Four practice questions: Mia, dog, London, park. Hints, adult-help marking, safe skip, gentle explanatory feedback, and manual next controls.
- Three fresh exit questions: Aisha, shop, and choosing Tuesday/tuesday. No hints; correctness/explanations are delayed until the summary. Help/skip never earns independent credit.
- Parent summary separates unhinted first responses, hinted responses, and adult-assisted responses. Assisted takes precedence when both help and a hint were used; item review preserves both flags. Exit evidence is separate. Skips are included in assisted counts. No mastery label; parent follow-up requests a new example and explanation, then later recall.

Examples are fixed; replay is explicitly not a fresh assessment. Reading the exact prompt without providing clues is not answer assistance in independent mode; select adult help if clues are given. Guidance selection itself marks answers assisted rather than inferring who is present.

## Privacy and speech

Game answers are held in memory only. Reload clears them. This page does not load `hub.js`, so it neither reads profiles nor invokes the hub's remote syncing/session APIs. The existing hub registry provides the card/link only. No persistence is claimed.

Read aloud/replay uses browser speech synthesis, triggered by a button; missing APIs, thrown failures, and synthesis errors show an adult-reading fallback. The browser/device may use speech services for generic narration; answers are not narrated as a data submission. Device audio and child independent usability must be checked on the actual tablet. API-dispatch tests are not proof of audible audio.

## Verification

`npm test` runs the model, shell and registry tests plus the existing suite. Each implementation slice was preceded by a failing assertion (model, shell, practice UI, exit UI, summary UI, registry; speech navigation cancellation was reproduced before repair).

Real Chromium verification uses Browser Use/CDP with touch emulation at 768×1024, 1024×768, and 390×844. It exercises wrong responses, hints, help, safe skips, locking, delayed feedback, separate report buckets, guided mode, all-correct independent checks, replay/reset, minimum 48px controls, no horizontal overflow, and missing/throwing speech APIs. Browser errors and resource origins are checked. No physical tablet, Safari, screen reader or audible-output verification is claimed.

The local QA driver and raw evidence are intentionally stored outside the repository under the active profile's scratch directory; they contain only anonymous synthetic test responses. Preview must be approved before merge to main or production deployment.
