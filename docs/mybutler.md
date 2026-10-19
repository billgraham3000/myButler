# MyButler (private, owner only)

MyButler is a personal advisor that gets to know its owner: likes, tastes, friends and relatives, hobbies, and their normal week. Twice a day, and whenever asked, it looks for things worth doing: events, reminders, chores, birthdays, vacation ideas. Its suggestions get better as it learns from feedback. It has its own calendar built around the owner's routines, and later it can be talked to by voice in German, English or a mix of both.

Owner idea and decisions 2026-10-18. The working title was "Advisor"; the owner named it MyButler.

**History.**
- Phase 1 (the MVP) was built on 2026-10-18 inside 4Muses, at www.4muses.com/mybutler/.
- On 2026-10-19 (owner decision) it moved to its own home:
  - the app: https://salmon-grass-0ae222003.2.azurestaticapps.net
  - Azure resource group `myButler`
  - the repository `billgraham3000/mybutler`
- It now has its own sign-in instead of 4Muses accounts.
- What changed from the plan while building is in "Phase 1 as built" below. Where this doc names 4Muses files or resources, that is the history; the current layout is in `CLAUDE.md` and `docs/azure.md`.

## Owner decisions

- **Private, for the owner only, for now.** Since 2026-10-19 it is a separate app with its own Azure resources and sign-in (only the owner's email can sign in). Until then it lived inside 4Muses to reuse accounts, storage, keys and the timer.
- **Its own calendar, not Google Calendar.** The calendar starts from the owner's normal weekly schedule, described in words, not entered appointment by appointment.
- **Voice like a conversation with Claude**, in German, English, or a mix in the same sentence.
- **Storage in blobs, not a database, to start.** One person's data is small. Move to a database only if it ever serves more people.
- **Home: Munich, Bavaria.** Events are searched around Munich, and public holidays are Bavaria's (Epiphany, Corpus Christi, All Saints' and the rest), plus Assumption Day on 15 August, which Bavaria keeps only in some towns, Munich among them.
- **Digest at 6:00 and 18:00** (Munich time), in the app **and** by email.
- **Voice starts with OpenAI** for speech-to-text and text-to-speech, because its key is already in the key vault. ElevenLabs or Deepgram only if mixed German/English isn't good enough.

## What it does

1. **Learns about the owner** through conversation and feedback:
   - facts (tastes, budget, dislikes, home town);
   - people (relationship, birthday, interests, gift ideas);
   - hobbies;
   - memories ("loved the wine fest in Wiesbaden").
2. **Knows the owner's week** from routines (see Calendar).
3. **Looks for suggestions** at about 6:00 and 18:00, and when asked:
   - events nearby that fit;
   - birthdays coming up, with gift or plan ideas;
   - chores that are due;
   - free weekends that suit a short trip;
   - the weather for planned outdoor things.
4. **Only speaks up when something is worth it.** If nothing passes the bar, there's no digest. That's normal, not an error.
5. **Learns from feedback.** On every suggestion the owner can answer: 👍, 👎, "not interested because…", "remind me later", or "did it". All of it feeds back into what it knows.

## Calendar

The owner's week is the base layer. Single appointments are the exception.

- **Routines** are recurring patterns, such as "Gym Mon/Wed/Fri 6:00–7:00", "Office Tue–Thu until 17:00", "Sunday call with Mom around 16:00". Each one has:
  - a rule: weekly on given days, every N weeks, monthly on a day or weekday, or yearly;
  - start and end time, or "around" a time;
  - **fixed or flexible.** Flexible means "usually, but can move or skip", and MyButler may suggest something over it. It never suggests over a fixed one.
  - valid from / until, for "until the end of the school year" or "from November".
- **Exceptions:** "no gym this week", "office Friday instead of Thursday".
- **Periods:** vacation, sick, guests staying. A period can pause some or all routines.
- **One-off events:** appointments, things the owner accepted from a suggestion.
- **Holidays:** German public holidays for the owner's state, computed in code, with the state set once in settings.
- **The week is computed, not stored.** For any date range, the code expands routines, then applies periods, exceptions and holidays, then adds one-offs. This is plain code with tests (`tools/check-mybutler.mjs`), not the AI.
- **Entering routines by talking:**
  - The owner says, for example, *"Dienstags und donnerstags bin ich normally im Büro bis 17 Uhr."*
  - The AI turns this into a routine, reads it back in plain words ("Office, Tuesday and Thursday, until 17:00, fixed — right?"), and saves it after a yes.
  - The calendar screen allows the same edits by hand.
- **Noticing drift:** after a few weeks, it may say something like "You skipped Wednesday gym three weeks running. Change the routine?" It asks; it never changes routines on its own.
- **Time zone:** Europe/Berlin by default, set in settings. Times are stored with their zone, so daylight saving changes don't move things.
- **Later:** export as an `.ics` feed, so the week can also show in a phone's calendar app.

## How the AI part works

- **Model:** Claude, through the existing `api/src/engine/models.js` plumbing, with its own setting `BUTLER_MODEL`. The default 4Muses model is a small, cheap one; MyButler needs a stronger one. It uses the existing `ANTHROPIC-API-KEY` in the key vault.
- **Every request gets the owner's whole profile.** The full profile (facts, people, routines, chores, the coming two weeks, recent feedback and a summary of older memories) is a few tens of kilobytes, small enough to send in full on every request. So there's no search index or embeddings to start. Those come only if memories outgrow this.
- **The AI changes data only through tools**, such as:
  - `add_fact` / `update_fact`
  - `add_person` / `update_person`
  - `add_routine` / `add_exception` / `add_period` / `add_event`
  - `add_chore` / `complete_chore`
  - `get_week` / `find_free_time`
  - `search_events` / `get_weather`

  Each tool checks and limits its input in code, as the Jar does with its building blocks.
- **Stated vs. inferred:**
  - Something the owner says outright ("I don't like crowds") is saved as *stated*.
  - Something the AI concludes ("seems to prefer outdoor things on Saturdays") is saved as *inferred*, with a confidence, and is shown and confirmed before it carries weight.
- **Where suggestions come from:**
  - an events API (Ticketmaster Discovery to start);
  - weather from Open-Meteo (free, no key, EU);
  - holidays computed in code;
  - Claude's web search for local things the APIs miss.

  Every event suggestion must link to a real source with a checked date and time. The AI ranks and writes the suggestion text; it never invents an event.
- **Reminders don't use the AI.** Chores, birthdays and renewals fire from plain rules in the timer. The AI only adds context ("Mom's birthday is in 10 days; she mentioned pottery, and there's a class on the 14th").
- **Weekly tidy-up:** once a week the AI reads the week's feedback and memories and rewrites the profile summary. Changes to stated facts are proposed, not applied.

## Voice (phase 2)

- **Push-to-talk first.**
  - **2a:** the owner holds a button and speaks. The browser records a short clip and sends it to the API. The API turns it into text (a speech-to-text service that handles German and English switching mid-sentence), asks Claude, turns the answer into speech, and returns text and audio.
  - **Why not live streaming:** 2a needs no long-lived connections, which the Flex Consumption function app isn't suited for. Expect about 2–4 seconds per answer.
  - **2b, if 2a feels slow:** the browser streams directly to the speech services, using short-lived tokens from our API, to get to about 1 second.
- **Language:**
  - It answers in the language the owner used.
  - A mixed question may get a mixed answer.
  - The voice must read both languages in one consistent voice. Pick the text-to-speech voice for that.
  - Pennsylvania Dutch is out of scope: no speech service handles it well.
- **Short spoken answers, details on screen.** For example: "Three things for Saturday — they're on your screen."
- **Audio is never stored**, only the text of the conversation.
- **Vendors (owner decision: OpenAI first):** OpenAI transcription for speech-to-text and OpenAI text-to-speech, using the key already in the vault. Try mixed German/English sentences early; if the transcript or the voice handles the switch badly, move that part to Deepgram multilingual (speech-to-text) or ElevenLabs multilingual (text-to-speech). Any new key goes in the key vault, never in chat.
- **Site settings to change:**
  - `web/staticwebapp.config.json` blocks the microphone site-wide (`Permissions-Policy: microphone=()`). Allow it for `/mybutler/*` only, through that route's own headers.
  - Add any services the browser calls directly to `connect-src` in the security policy.

## Privacy

- **Owner only:**
  - Every MyButler route checks the signed-in player with `isOwner()` (`api/src/lib/usernames.js`). For anyone else it answers 404, as if nothing were there.
  - Not in the games catalog, not in search, not counted by `/played`.
- **Kept out of everything shared:** no admin-page view of the contents, nothing in the daily summary email, nothing in rankings, points or groups. The admin key gives no route to read it.
- **Storage:**
  - Private blob container `mybutler` (with `TABLE_PREFIX` for tests, as other containers).
  - Read and written by the function app's managed identity, encrypted at rest by Azure.
  - Data stays in West Europe.
  - Anyone with owner rights on the Azure subscription can still open the container. That's the owner, so it's accepted.
- **Friends and relatives:** only what helps the advice (relationship, birthday, interests, ideas, address). No phone numbers or emails.
- **Addresses** (owner decision 2026-10-19, "keep addresses so you can advise on travel"): people have an `address` field, and the owner's own home address is `address` in `settings.json`, set in Settings or by telling MyButler (tool `set_home_address`).
- **History and undo:**
  - Blob versioning and soft delete are turned on for the container, so a wrong "learned" change can be rolled back.
  - Conversation files are deleted after 90 days.
- **"What I know about you" page:** shows every fact, person, routine and memory, marked stated or inferred. Each can be edited or deleted.
- **Export and delete everything:** two buttons, so the owner can take the data away or wipe it.

## Storage layout

Blob container `mybutler`, one folder per player id (only the owner for now; keeping the id in the path means opening it to more people later only removes the owner check).

```
<playerId>/profile.json             facts (stated/inferred, confidence, source, dates) and the summary
<playerId>/people.json              friends and relatives
<playerId>/routines.json            routines, exceptions and periods
<playerId>/events-2026-10.json      one-off events, one file per month
<playerId>/chores.json              chores and reminders with their rules and last done
<playerId>/goals.json               goals and dreams, their steps and progress notes
<playerId>/settings.json            time zone, state for holidays, home town, digest times, voice choice
<playerId>/memories.jsonl           notes, appended
<playerId>/suggestions-2026-10.jsonl  what was suggested, and the feedback, appended
<playerId>/talk-2026-10-18.jsonl    conversation text, one file per day, deleted after 90 days
```

- **Edited files use version checks**, as the Jar and Trade already do with `store.getJson` / `store.putJson` and ETags. If a timer run and a conversation write at the same moment, the second one re-reads and tries again, so nothing is lost.
- **Files that only grow are appended.** These are memories, suggestions and conversations, split by month or day.
- **All reads and writes go through `api/src/mybutler/store.js`**, so a later move to Table Storage or a database changes one file.

## Built with (as planned; see "Phase 1 as built" for the details)

- **Server:**
  - `api/src/mybutler/` with `store.js` (the files above), `calendar.js` (routines → week, holidays, free time), `tools.js` (the AI's tools and their checks), `chat.js` (a conversation turn), `scan.js` (the twice-daily look), `sources.js` (events, weather, web search), `voice.js` (phase 2).
  - Routes in `api/src/functions/http.js` under `mybutler/…`, all player-auth plus the owner check.
- **Timer:** a step in the hourly timer in `api/src/functions/timers.js`, once per slot (`mybutler:<date>-am` / `-pm`) after 6:00 and 18:00 in the owner's time zone, catching up if an hour was missed, as the Jar does.
- **Browser:** plain JavaScript in `web/mybutler/` (no build step), with five screens:
  - Today: digest, reminders, ask box, push-to-talk;
  - Week: the computed calendar, with routines shown differently from one-offs;
  - People;
  - What I know about you;
  - Settings.
- **Tests:** `node tools/check-mybutler.mjs` for the calendar rules: recurrence, exceptions, periods, holidays, daylight saving, free time.
- **Email digest** to the owner's address through the existing `api/src/lib/mail.js`, with the same content as the in-app digest and a link back. Phone push notifications come later.

## Phase 1 as built

**Code**
- **Server, in `api/src/mybutler/`:**
  - `store.js`: the files.
  - `calendar.js`: routines → week, holidays, free time, chores and birthdays.
  - `tools.js`: the AI's tools and the page's edits, with the same checks.
  - `chat.js`: one conversation turn, and the profile as text.
  - `scan.js`: the look, the digest email, feedback, the Today view and the timer step.
  - `sources.js`: Ticketmaster, Open-Meteo weather and town lookup.
- **Calling Claude:** with tools through `claudeTools()` in `api/src/engine/models.js`.
- **Web:** `web/mybutler/`, plain JS.
- **Account screen:** shows a MyButler link to the owner only.
- **Tests:** `node tools/check-mybutler.mjs` runs 132 checks:
  - the calendar rules;
  - the tools' input checks;
  - a chat turn and a scan, against stand-ins for Claude, Ticketmaster and Open-Meteo.

**Routes** (`/api/mybutler/…`)
- The routes: `state`, `week`, `chat`, `scan`, `confirm`, `feedback`, `edit`, `settings`, `export`, `delete-all`.
- Each one looks up the signed-in player itself. Anyone who isn't the owner gets an empty 404, signed in or not, so the routes look like addresses that don't exist.
- Limits are counted per address.
- The static page at `/mybutler/` is public but holds no data. It is marked noindex and shows "Page not found" to anyone the API turns away.

**Calendar details**
- **Holidays:**
  - all 16 states are in code;
  - Assumption Day is a setting, on for Munich.
- **Routines:**
  - each routine has `onHoliday: skip | keep`, default skip, for work and classes; the AI is told to choose keep for personal things;
  - an exception can skip a range, move one date, or change the times.
- **Free time:**
  - only fixed plans block time;
  - an item with only an end ("office until 17:00") blocks the day up to then;
  - a start without an end blocks one hour.
- **Week screen:** starts from today, not Monday.

**Confirmation is enforced in code, not just asked for in the prompt**
- New or changed routines, exceptions and periods are saved as proposals in `routines.json`.
- A proposal is saved only:
  - after a **Yes** button on the Today screen; or
  - when the AI calls `confirm_proposal` in a *later* message than the one that proposed it.
- Inferred facts show as "guess" on the What I know page until the owner taps Right.

**Reminders (rules, no AI)**
- Chores that are due, or within their `remindDays`.
- Birthdays within 14 days.
- Today's and tomorrow's one-off appointments.
- Rain of 60% or more on outdoor routines in the next three days.

**The look**
- **What it reads:** the profile, the next 14 days, free time (2 h or more), free weekends (with holiday Fridays and Mondays), Ticketmaster events if the key is set, and Open-Meteo weather. It can also run up to 5 web searches.
- **How it answers:** Claude hands in its picks with a `submit_digest` tool.
- **Checks in code:**
  - A score of at least 0.6, and at most 6 picks.
  - A Ticketmaster pick takes its date, time and link from Ticketmaster itself.
  - Any other event needs a link that one of that look's web searches actually returned, and a date within the next month. Anything else is dropped.
  - Nothing suggested in the last 45 days is suggested again.
- **When nothing passes:** no email, and the last digest stays on the Today screen.
- **The email:**
  - It holds new suggestions.
  - It also holds reminders that are new since the last digest, plus the morning's reminders due today. So an overdue chore doesn't arrive twice a day.
  - **Look now** on the page shows the result in the app and doesn't email.
- **Timer:**
  - The hourly tick runs the newest slot that is due, once.
  - A missed morning is not run after 18:00; the evening slot covers it.
  - A slot that fails three times is given up, so a broken key can't run up costs.
  - Conversation files older than 90 days are deleted in the evening slot.

**Prompt bar and calendar (2026-10-19, owner request)**
- **Prompt bar:**
  - It is docked above the tabs on every screen. Sending from another screen switches to Today, where the conversation is.
  - While MyButler is answering, the button reads Queue: further messages wait and go out one after another.
  - It shows how long MyButler has been thinking.
- **Messages:**
  - A message can hold up to 6,000 characters (raised from 2,000).
  - Every request gives up after a while: 3 minutes for chat, 30 seconds for the rest. The text, and anything still waiting, goes back into the box. This was the cause of a stuck Send button on mobile data.
- **Calendar** (the Week tab, now called Calendar), with Day, 3 days, Week, Month and List views:
  - The default is 3 days on phones and Week on wide screens; the choice is remembered.
  - Time grids run 0:00 to 24:00, with a line at the current time, and side-by-side columns when entries overlap.
  - Holidays, periods and entries without a start time sit in an all-day row.
  - Colors: fixed routines blue, flexible ones dashed, appointments orange, holidays green, periods purple.
  - Tapping a day's header or a month cell opens that day.
- **Editing from the calendar:**
  - Tap an empty half hour to add an appointment there.
  - Tap an appointment to edit or delete it. The new `update_event` tool (also available to the AI) can move it to another day or month.
  - Tap a routine to skip or move just that occurrence (an exception that replaces any earlier change to the same day), to put a moved one back, or to edit the routine.
- **Wide screens:** the app is up to 980 px wide.

**Goals and dreams (added 2026-10-19, owner request)**
- Stored in `<playerId>/goals.json`, separately from facts. Each goal has:
  - title, kind (goal or dream) and why it matters;
  - a time frame (this month, this year, next few years, someday) and an optional target date;
  - steps, each with an optional due date and a done date;
  - progress notes (the last 20);
  - a status: active, paused, reached or dropped.
- **The AI's tools:** `add_goal`, `update_goal` (also records progress notes), `add_goal_step` and `complete_goal_step`. It is told to save goals there, not as facts, and to offer once to move goals it had saved as facts before.
- **Reminders (rules, no AI):**
  - steps due within 3 days, or overdue;
  - a check-in ("How is … going?") after 7, 30, 60 or 90 days, by time frame, unless the goal sets its own interval (0 = never);
  - a progress note or a finished step counts as a check-in.
- **Suggestions:** active goals go with every request and every look, and the look may suggest things that move a goal forward (suggestion kind "goal").
- **Page:**
  - a "Goals and dreams" card at the top of the About you tab, with a progress bar, tickable steps, the latest note, and Add step, How it's going, Edit and delete;
  - reached and dropped goals are behind a "Show" link;
  - on Today, due steps have a Done button and check-ins an Update button.
- **Limit:** 50 open goals, 30 steps each.

**When Claude's answer is cut off (fixed 2026-10-19)**
- A long message with many facts (riding times, people, the horse) used to end in "Sorry, I couldn't finish that", with nothing saved: the answer hit its length limit mid-way.
- Now:
  - a cut-off answer is asked again with twice the room (up to 16,000 tokens); the half-written tool calls are never run;
  - if the tools ran but no words came back, Claude is asked once to answer;
  - if still no words come back, the reply lists what was saved.
- The log notes any turn that ends without words ("mybutler chat: no reply text").

**Feedback**
- 👍 and 👎 are recorded.
- "Not interested because…" and "Did it" also become memories.
- "Remind me later" hides the suggestion for two days.
- All feedback goes with every later request.

**Files added to the layout**
- `digest.json`: the latest digest, replaced each time.
- Logs (memories, suggestions with feedback, talk) are Azure append blobs, so two writers can't overwrite each other.

**Model**
- The app setting `BUTLER_MODEL` names the stronger Claude model. The owner chose the strongest Claude model on 2026-10-18; the exact name is in the function app's settings.
- In the separate app there is no built-in default: `BUTLER_MODEL` must be set (copied from 4Muses at the move). An optional `FALLBACK_MODEL` is tried if that model is unavailable.

**Events key (Ticketmaster)**
- **Status 2026-10-18:** the owner will add the key later; until then MyButler uses web search for events.
- **While the key is missing:** the events source is off and says so on the Settings screen. The look uses web search instead.
- **To switch it on:**
  1. Get a free key at developer.ticketmaster.com (the "Consumer Key" of an app).
  2. In the Azure portal, open the key vault `kv-mybutler-mbjcu1`, choose Secrets, then Generate/Import, and add it as `TICKETMASTER-API-KEY`. Never paste it into a chat.
  3. The function app `func-mybutler-mbjcu1` already has the setting `TICKETMASTER_API_KEY` pointing at that secret; restart the app after adding it.
  4. Save, which restarts the app.
- It switches on by itself; no code change is needed.

**History and undo (on since 2026-10-18, owner decision)**
- On the storage account `st4muses51jn`:
  - blob soft delete and container soft delete, 14 days each;
  - blob versioning.
- Versioning is account-wide, so lifecycle rules keep it cheap:
  - old versions are deleted after 1 day in every other container (rules `old-versions-1-day-a` and `-b`, one prefix per container);
  - after 30 days everywhere else (rule `old-versions-30-days`), which covers `mybutler/` and any container added later.
- A new container that should not keep versions for 30 days needs its prefix added to one of the 1-day rules (at most 10 prefixes per rule).
- To undo a wrong change: in the portal, open the blob in container `mybutler`, then Versions, then make an older version current.

**Left for later:** noticing drift, the weekly tidy-up, `.ics` export, push notifications and voice (phase 2).

## Phases

1. **MVP:** text chat, profile, people, routines and calendar, chores, the twice-daily scan with an in-app and email digest, feedback, the "What I know" page, export and delete.
2. **Voice:** push-to-talk (2a), then streaming if needed (2b).
3. **Polish:**
   - noticing drift in routines;
   - the weekly tidy-up;
   - `.ics` export;
   - phone push notifications;
   - hands-free voice;
   - more event sources;
   - trip ideas for longer free stretches.

## Cost (rough)

- **Azure:** almost nothing extra, because storage, functions and the key vault already exist.
- **Claude:** two scans a day plus conversations is a few euros a month with a stronger model.
- **Voice:** a few cents per minute of talking.
- **Ticketmaster Discovery:** free within its limits.

## Open questions for the owner

None right now. Answered 2026-10-18: Munich, Bavaria; digest in the app and by email; 6:00 and 18:00; voice with OpenAI first; the name MyButler.
