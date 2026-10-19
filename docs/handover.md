# Handover: MyButler, 2026-10-19

From the session that built MyButler inside 4Muses and moved it here, to the session that continues it. Read `CLAUDE.md`, then `docs/mybutler.md` (design, decisions, "Phase 1 as built") and `docs/azure.md`. This page adds what those don't: the state today, the open threads, and the lessons learned.

## State today

- **Live:** https://salmon-grass-0ae222003.2.azurestaticapps.net
  - The API is https://func-mybutler-mbjcu1.azurewebsites.net/api.
  - `/api/health` shows `claude: true, email: true, events: false`.
- **The owner is set up:**
  - signed in with the emailed link;
  - added a passkey (Face ID) on 2026-10-19;
  - added `ANTHROPIC-API-KEY` to `kv-mybutler-mbjcu1`.
- **The owner's data was copied over from 4Muses** on 2026-10-19: profile, people, routines, digest, and the talk of 2026-10-19.
  - Folder: `mybutler/MFi23t8zZ9IW/` in `stmbjcu1butler`. `OWNER_ID` is that 4Muses player id.
  - The old copy stays in 4Muses storage (`st4muses51jn`, container `mybutler`) as a backup until 2026-11-30. Deleting it then is the 4Muses session's job.
- **4Muses no longer has MyButler:**
  - `www.4muses.com/mybutler/` redirects here (302);
  - its code is in the 4Muses git history up to commit `dd82929`.
- **Model:** `BUTLER_MODEL` is set, to the strongest Claude model, per the owner's choice. Model names stay in app settings, never in code, docs or commits.

## What the owner has asked for, and what is still open

1. **Re-send the hobbies message.** On 2026-10-19 a long message about hobbies never reached the server: a dropped mobile connection, and the page had no timeout then. The owner was told to send it again. Nothing to build; check that the hobbies show up under About you once they do.
2. **Feeding many facts in long paragraphs** (people, birthdays, schedules, addresses, life goals, tasks for this week and month) is the owner's plan. MyButler handles it:
   - messages up to 6,000 characters;
   - a cut-off answer is retried with more room;
   - a reply without words lists what was saved.

   Watch the first long messages in the logs (`mybutler chat: no reply text` is logged if it ever happens again).
3. **Addresses for people: done 2026-10-19.** The owner said to keep addresses for travel advice; people have an address field and the owner's home address is in Settings. Was: the owner wants to store addresses. The code currently drops them on purpose (`cleanPerson` in `tools.js`, and the system prompt says "no addresses"); the design doc said "unless the owner adds them for a reason". Offered: an `address` field for people and the owner. The owner hasn't answered yet, so ask before building.
4. **Ticketmaster:** the owner will add `TICKETMASTER-API-KEY` to the vault later. The app setting already points there; restart the function app after the key is added. Until then the look uses web search.
5. **Voice (phase 2), planned in `docs/mybutler.md`:** push-to-talk, with OpenAI speech-to-text and text-to-speech first.
   - **Key:** the OpenAI key is not in this vault yet; the owner adds it as `OPENAI-API-KEY`.
   - **Microphone:** `web/staticwebapp.config.json` sends `Permissions-Policy: microphone=()`, which blocks it. Allow `microphone=(self)` when building voice.
   - **Security policy:** add any service the browser calls directly to `connect-src`.
6. **Phase 3, later:** noticing drift in routines, the weekly tidy-up, `.ics` export, push notifications, more event sources, trip ideas.
7. **The calendar** was rebuilt on 2026-10-19 to look like Google Calendar, at the owner's request:
   - views: day, 3 days, week, month, list;
   - tap an empty slot to add an appointment;
   - tap a routine to skip or move one occurrence.

   No owner feedback on it yet.

## How things work (the parts that bite)

- **Saving routines:** the AI changes data only through `api/src/butler/tools.js`. Routines, exceptions and periods are proposals: they are saved only after a Yes button, or when `confirm_proposal` comes in a *later* message than the proposal. Keep that rule.
- **Events:** never invented. `scan.js` drops any event that didn't come from Ticketmaster, or whose link wasn't in that look's web-search results.
- **Sign-in:** `api/src/lib/auth.js` and `passkey.js`.
  - Only `OWNER_EMAIL` gets a link.
  - Sessions are hashed JSON files in container `auth`, valid 180 days.
  - Passkeys belong to the host name in `SITE_URL`. A custom domain later means adding Face ID again.
- **Timer:** `timers.js` runs hourly at :05.
  - It runs the newest due slot (6:00 or 18:00 owner time) once; a flag in container `state` records it.
  - It gives up after three failed tries.
  - It skips the look entirely while nothing is known about the owner.
- **Limits:** request counters are blob files in `state/limits/`, cleaned hourly.

## Working notes

- **Tests:** `cd api && npm install && cd .. && node tools/check-mybutler.mjs` (132 checks; in-memory store, stand-ins for Claude, Ticketmaster and Open-Meteo). Run before every deploy.
- **Browser testing:**
  - Serve `web/` from a small Node server that answers `/api/*` with the real modules on the in-memory store (`store.useMemory()`), and set `window.MYBUTLER_API = '/api'` in a stand-in `config.js`. Then drive it with Playwright.
  - Playwright is installed globally; don't install browsers.
  - **Live tests through this sandbox's proxy** are unreliable. They need `chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } })` and `ignoreHTTPSErrors: true`, and they still time out at times; `curl` checks of each file are the dependable fallback.
- **Deploy:** `scripts/deploy-api.sh`, then `scripts/deploy-web.sh`.
  - The Azure CLI sometimes fails with "Connection reset by peer"; just run it again.
  - Verify by comparing sha1 of the local and live files, and check `/api/health`.
- **Azure access:**
  - The agent's service principal (`modular2-claude-agent`) is Owner on resource group `myButler`, and Key Vault Secrets Officer on the vault.
  - It has **no** data role on the storage account. The function app reads data with its own identity.
  - The owner allowed using the storage account key for the data move; don't read the owner's data otherwise unless they ask.
- **Logs:** Application Insights `appi-mybutler` (appId `f9199223-99e2-4b60-a674-2575fde8ff53`):

  ```
  az monitor app-insights query --app f9199223-99e2-4b60-a674-2575fde8ff53 --analytics-query "requests | where timestamp > ago(1h)"
  ```
- **GitHub:**
  - The session needs the repo `billgraham3000/mybutler` attached (add_repo). The Claude GitHub app is installed on it.
  - The default branch is `main`; the owner has had changes pushed straight to `main` and deployed.
- **Talking to the owner:** they write short messages, often from a phone, and send screenshots of problems. Answer in plain words; say what was tested live and what wasn't.
