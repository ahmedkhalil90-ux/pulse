# Pulse — Project Rules

Read this file fully before making any change.

## What Pulse is

An anonymous binary polling and social question app. Users answer two-choice questions, see aggregated percentage results, and explore how demographic groups answered. Target market: UAE and MENA, Arabic-speaking millennials and Gen Z. Android first, iOS later.

**The single core promise is radical anonymity.** No individual answer is ever visible to anyone, in any context, ever. Every feature is designed with anonymity as the primary constraint, not an afterthought.

Project owner: Ahmed. He makes all product decisions. Flag concerns; do not act unilaterally on product questions.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| Backend | Firebase Firestore |
| Auth | Firebase Auth |
| AI moderation | Gemini API (`gemini-3-flash-preview`) |
| Styling | Tailwind CSS 4 (dark mode first) |
| Animation | motion/react |
| Icons | lucide-react |
| Toasts | sonner |
| Mobile (planned) | Capacitor |

## The three core engines

1. **Anonymity Enforcement Layer** — the constraint system below. Highest priority.
2. **Credit Economy** — earning, spending, atomic operations.
3. **Game Mode State Machine** — lobby → submitting → playing → results → finished.

Changes to any of these require explicit approval before implementation.

---

## HARD RULES — never violate

### Anonymity

- No answer is ever stored or exposed with a user identifier in any readable or queryable public way.
- Results are only ever displayed as aggregated percentages. Never individual choices.
- Question posters cannot see individual answers — percentages only.
- In groups and game mode, no player can ever see another player's specific answer.
- Demographic breakdowns require a **minimum of 10 responses** in that group before displaying. This threshold is absolute — paying 3 credits to unlock does not override it. Show "Not enough responses in this group yet" instead.
- Phone numbers are hashed immediately after verification. Never stored in plain text, never displayed, never logged.
- Username is the only public identity and is never linked to any answer.
- "Your answer is anonymous" confirmation appears after every submission.
- Revisit answer history is stored privately, never shown in any shared context.
- Game predictions are stored privately, never exposed.
- Group members tab shows **count only** — never individual usernames.

### Credits

- Credits can NEVER go below zero. Always check balance before deducting.
- All credit operations MUST use Firestore atomic increments. Never read-then-write.
- Every credit change shows a brief toast confirming the change.
- Credit balance is always visible in the top bar.

### Posting is always free

Posting a question to the public feed, to a group, or in game mode is **ALWAYS FREE**. No credits are ever deducted for posting, under any circumstance. This is a core design principle — charging for posting would suppress content creation and harm app health. Do not propose changing this.

---

## Settled decisions — do not re-open

These have been reviewed and decided by Ahmed. They are intentional. Do not flag them as bugs, do not "fix" them, do not raise them again.

1. **Referral credit timing** — the current timing is intentional.
2. **Group anonymity threshold of 5** — intentional for groups specifically. Do not change it to match another number.
3. **Flag button visible before answering** — intentional.

If you believe one of these is genuinely dangerous, say so once, in plain terms, and stop. Do not implement a change.

---

## Data model

Collections: `users/{userId}`, `questions/{questionId}`, `results/{questionId}`, `user_answers/{answerId}`, `groups/{groupId}`, `games/{gameId}`, `users/{userId}/unlockedDemographics/{questionId}`.

Full field-level schema lives in the Pulse Product Document. Key constraints:

- `questions.text` max 100 chars; exactly two options, max 40 chars each
- `questions.status`: `pending` | `live` | `rejected`
- `questions.authorUid` is `pulse_originals_system` for the 210 seed questions
- `results` holds only aggregate counts and nested demographic maps — never per-user data
- `unlockedDemographics` — once unlocked for a question, never charge again

## Credit values

| Action | Credits |
|---|---|
| Answer a question (feed or group) | +1 |
| Daily login bonus (first open per calendar day) | +3 |
| Referral (signup + first answer) | +15 |
| Boost a question (100 impressions) | −10 |
| Unlock demographic breakdown (one question) | −3 |
| Game power-up | −5 to −10 |

## Game mode scoring

Correct majority prediction = 1 point. Wrong = 0. 50/50 split = 0 for everyone, labelled "Perfectly Divided 🎯". Skipped = 0. Winner is the most accurate predictor — the "Best Mind Reader". Joint winners shown if tied.

Live mode: 30s to answer, 15s to predict. Async: answer any time before deadline (24/48/72h), results fully hidden until deadline or all players finish.

Game questions are exempt from AI moderation (private to session). Question author revealed only on the final results screen.

---

## UI conventions

- Dark mode first — black `#000000` background, zinc/white accents
- Borders `zinc-800`, rounded corners, ghost buttons for secondary actions
- Question cards large, full-screen, optimised for one-handed use
- Percentage bars animate in after answering
- All feedback via sonner toasts — brief, non-intrusive
- All transitions via motion/react
- All icons from lucide-react
- Bottom nav, 5 tabs: Feed, Groups, Game, My Questions, Profile
- Every error state must be clear and actionable — never a dead end
- "All Caught Up" screen should feel celebratory, not like an error

Do not introduce new UI libraries or a light theme without asking.

---

## Working agreement

**Before implementing anything non-trivial:** propose a plan and wait for approval.

**Requires Ahmed's explicit review — never change autonomously:**
- `firestore.rules`
- Any write path touching `results/`
- Credit arithmetic anywhere
- Demographic threshold logic
- Phone number hashing
- Anything in the three core engines

**Safe to proceed on:** dependency updates, test coverage, copy fixes, UI polish, seed content generation, refactors that do not touch the above.

**Testing:** 106 tests. `npm test` runs all of them against the Firestore emulator via `firebase emulators:exec`. Java is required.

- **Rules — 39 tests** (`tests/rules.test.ts`, cases in `tests/cases/`). Vote integrity, flagging and boosting, the UID-migration takeover fix, answer-record ownership, game reads, group updates, results reads.
- **Mutation verification** (`tests/mutation.test.ts`). Every deny-case names the mutation that should make it pass. The harness loosens that one guard in an in-memory copy of the rules, loads it into a throwaway emulator project, and asserts the case flips to allowed. `firestore.rules` is only ever read, never written. A mutation target that no longer matches exactly once throws, so a reworded rule breaks loudly instead of silently making a test vacuous.
- **Credit economy** (`tests/credits.test.ts`) and **game mode** (`tests/game.test.ts`).

Never write a test that passes whether or not the behaviour it tests exists. Every new rules test needs a matching mutation, and that mutation must be shown to kill it. Report the result of that verification — "all green" without it is not a report.

**CI:** `.github/workflows/ci.yml` runs `npm ci`, `tsc --noEmit`, `npm run build`, then `npm test` on every push and pull request to `main`. Check its status at https://github.com/ahmedkhalil90-ux/pulse/actions — never assume it is green and never report it as green without having looked. Red CI is a blocker, not a nuisance.

**Never:**
- Commit secrets. `.env` is gitignored — keep it that way.
- Deploy to production without being asked.
- **Weaken or delete a test to make a build pass. Report the failure instead** — whether the test or the code is wrong is Ahmed's call, not the agent's.
- Force push to `main`.

**Commit style:** short imperative subject line, one logical change per commit.

## Fixed and closed

Do not re-report these, and do not "fix" them again.

- Client env leak — `VITE_`-prefixed variables only; nothing else reaches the bundle.
- Firestore vote-integrity rules — a vote must match the caller's own answer record, on their own option and their own demographic bucket.
- `isMigrating` account-takeover vector — proof of ownership is the auth token, never a username field the caller can write.
- Flagging and revisit write paths.
- Moderation fails closed to `pending` on any error.
- Publish path no longer hardcodes `status: live`.
- Group feed filters on `status`.
- Feed shuffle works — the seeder writes `random`.
- Six credit bugs: boost overdraft, unlock overdraft, non-atomic boost, unlock double-charge, unlock race, daily bonus double-award.
- Game scoring double-count — advancing is idempotent per question.

## Open issues — in priority order

1. **`game_questions` exposes `authorUsername` to every player from write time.** Contradicts the rule that the question author is revealed only on the final results screen. Leakage among players, not to outsiders.
2. **`users` is listable by any authenticated user**, leaking every username with demographics and credit balance. Correct fix is a `usernames/{lowercased}` → `{uid}` mapping so lookups are `get` by document ID and `list` can be dropped. Note that uniqueness is enforced by Firebase Auth via the synthetic `username@pulse.app` address, not by this query — the query is an orphan-profile lookup and runs after sign-in, so tightening it does not break signup.
3. **`groups` read exposes the full member UID list.** The members tab is meant to show a count only. Needs a denormalised `memberCount` plus membership in a subcollection; the array cannot be hidden while `array-contains` queries and join-by-code depend on it.
4. **Results min-10 threshold and the 3-credit unlock are unenforceable in rules.** *(Blaze)* Rules are all-or-nothing on a document — they cannot withhold `demographics` or count a bucket before releasing it. Needs a callable Cloud Function.
5. **Gemini key still reaches the client bundle.** *(Blaze)* Needs moderation in a Cloud Function. **Must be resolved before public launch.**
6. **Vote replay.** *(Blaze)* A user who genuinely answered can repeat the `results` +1 indefinitely. Rules cannot detect a replay; needs a server-side transaction.
7. **No password recovery.** *(Blaze)* Synthetic `username@pulse.app` addresses cannot receive reset mail, so resetting one needs the Admin SDK. A user who forgets their password loses their account, credits, and history permanently.
8. **No admin moderation queue.** Questions correctly fail closed to `pending`, but nothing reviews them, so held questions sit indefinitely.

**Items 4–7 are blocked on the Blaze plan and should ship together** — they are all the same piece of work, a Cloud Functions codebase, and doing them one at a time pays the setup cost four times.

Also outstanding, unchanged: no IAP integration, referral system not built, Capacitor conversion not started.

## Current phase

Pre-beta. Priorities in order: (1) anonymity enforcement is airtight, (2) test coverage on the three engines, (3) shareable beta link for friends, (4) real-device testing, (5) Capacitor and Play Store.

Branch `security/collection-reads` is **unmerged, unpushed, and undeployed**, awaiting smoke-testing of join-by-code for both games and groups. Those two flows read a document before the caller is a member, so they are the paths most likely to have been tightened too far.
