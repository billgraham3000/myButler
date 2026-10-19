# MyButler

A private personal advisor for one person, its owner (Munich, Bavaria). It learns tastes, people, routines and goals through conversation, keeps a routine-based calendar, and twice a day (6:00 and 18:00 owner time) looks for things worth the owner's time, in the app and by email. Claude does the thinking. Design, decisions and history are in `docs/mybutler.md`; Azure details in `docs/azure.md`.

## Status

- **Live since 2026-10-19** at https://salmon-grass-0ae222003.2.azurestaticapps.net. Until then MyButler lived inside 4Muses (repo `billgraham3000/4muses`, `/mybutler/`); it moved to this repo and the Azure resource group `myButler` on 2026-10-19 (owner decision).
- **Sign-in:** only `OWNER_EMAIL` can get an emailed sign-in link; Face ID / passkeys can be added in Settings. Sessions last 180 days.
- **Waiting on the owner:**
  - `ANTHROPIC-API-KEY` in the key vault (Claude is off until then);
  - later `TICKETMASTER-API-KEY` for events.
- **Phase 1 is done:** chat, profile, people, goals, routines and calendar, chores, the twice-daily look, feedback, the What I know page, export and delete.
- **Next:**
  - voice (phase 2);
  - noticing drift, the weekly tidy-up, `.ics` export, push notifications (phase 3).

## Layout

- `api/`: the Azure Functions app (Node 22, ES modules).
  - `src/functions/http.js`: the routes.
  - `src/functions/timers.js`: the hourly tick.
  - `src/butler/`: MyButler itself:
    - `calendar.js`: plain rules, tested;
    - `tools.js`: the AI's tools and the page's edits, with input checks;
    - `chat.js`: one conversation turn, and the tool loop;
    - `scan.js`: the twice-daily look, the digest email and feedback;
    - `sources.js`: Ticketmaster, Open-Meteo;
    - `store.js`: the owner's files.
  - `src/lib/`: storage, email, Claude, sign-in, passkeys and the owner.
- `web/`: plain HTML, CSS and JS, no build step.
  - `app.js`: the whole page.
  - `config.js`: where the API is.
  - `staticwebapp.config.json`: the security headers.
- `tools/check-mybutler.mjs`: the tests (`node tools/check-mybutler.mjs`). They use an in-memory store and stand-ins for Claude, Ticketmaster and Open-Meteo.

## Working in this repository

- **Deploy:** `scripts/deploy-api.sh` and `scripts/deploy-web.sh`. These need the Azure CLI signed in with access to resource group `myButler`.
- **Tests:** run `node tools/check-mybutler.mjs` before every deploy, after `npm install` in `api/`.
- **Rules that hold:**
  - The AI changes data only through the tools in `api/src/butler/tools.js`.
  - Routines, exceptions and periods are only proposed, and saved after the owner says yes in a later message.
  - Events are never invented: each one must come from a source the code checked.
- **Keys:** keys go in the key vault, never into code, chat or commits. Model names are app settings (`BUTLER_MODEL`), not code.
- **Owner's data:** the data is the owner's alone. Don't read it unless the owner asks, and never print its contents into logs or commits.
