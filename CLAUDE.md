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

**Testing:** never write a test that passes whether or not the behaviour it tests exists. Verify each new rules test fails when its rule is removed. Report the result of that verification.

**Never:**
- Commit secrets. `.env` is gitignored — keep it that way.
- Deploy to production without being asked.
- Delete or weaken a failing test to make a build pass. Report the failure instead.
- Force push to `main`.

**Commit style:** short imperative subject line, one logical change per commit.

## Known issues

- Gemini API key currently reaches the client bundle. Interim fix applied for beta; proper fix is moving moderation to a Cloud Function (requires Blaze plan). **Must be resolved before public launch.**
- No IAP integration yet.
- Referral system not yet built.
- Capacitor conversion not yet started.

## Current phase

Pre-launch beta. Priorities in order: (1) anonymity enforcement is airtight, (2) test coverage on the three engines, (3) shareable beta link for friends, (4) real-device testing, (5) Capacitor and Play Store.
