# Overnight run — 2026-08-21

Autonomous security run. No merges to `main`, no live deploys, no Blaze or
billing changes — all left for Ahmed.

**Status: in progress.** This file is updated as each item completes.

---

## Item 0 — games write-branch tightening (`security/collection-reads`)

**Done.** 169 tests passing, tsc clean, build clean, rules compile clean.

The blanket `(request.auth.uid in resource.data.players)` branch granted any
player write access to every field, defeating the caller-pinning added with the
status gate: a player could add an outsider to a game in progress, and that
outsider then satisfied the read rule. Replaced with five explicit branches.

| Branch | Permitted |
|---|---|
| Join | lobby only, self only, `players` + `scores` only |
| Leave | self only, `players` only |
| Host | `status`, `currentQuestionIndex`, `scores`, `scoredQuestions`, `deadline`, `questionsPerPlayer`, `lastUpdated` — never `players` |
| Player | own `answers`/`predictions`/`playerQuestions` keys, `questions` append-only |
| Admin | unchanged |

Mutations M28–M33, one per clause, all killing. The two deliberately-failing
tests from the previous session are green.

**Tracing caught a break before it shipped.** `GameLobby.leaveGame` lets a
non-host remove themselves from `players`. The approved spec said "nobody may
modify players outside the join branch", which would have made leaving a game
impossible. It has its own branch, with cases proving you can remove yourself
but not anyone else.

### Follow-on fix within the same item

The `role` guard shipped earlier in this branch covered `update` only.
`allow create: if true` meant a new account could be created holding
`role: 'admin'` outright, and an owner could delete their own profile and
re-create it elevated. **The suite reported the door closed** because every
case exercised an update path. Creation now requires ownership and rejects
`role`. Mutations M34, M35. Found by the invariant-checker.

Commits: `7109b0e`, `00ddaab`.

---

## New findings — logged, not fixed

Per instruction: logged and carried, not blocking the queue.

### N1. A player can rewrite their own answer after seeing the split (game integrity)

`ownKeyOnly` pins *which* UID key changes, not the value. A player may
overwrite `answers.<self>.<qid>` repeatedly while the game is `active`.
`GameView` renders `GameResults` — the full percentage split — as soon as
everyone has answered and predicted, and the host may not have advanced yet. A
player on that screen can flip their own answer, change the majority, and
change everyone's score, because `advanceQuestion` scores from document state
at advance time.

Not an anonymity break — no other player's key is touched. It defeats "Best
Mind Reader" scoring. Fix belongs in the same player branch: require the
caller's per-question entry to be absent before permitting the write. Needs
care around the live-mode timeout path, which writes `-1`.

### N2. Any player can append arbitrary ids to `questions` mid-game (griefing)

Same clause. `hasAll` forbids removal but not addition. `GameView` indexes
straight into that list, so injected ids become questions everyone must sit
through. Low severity.

### N3. `awardReferral` cannot succeed under current rules (latent)

`src/lib/credits.ts` `awardReferral` updates the **referrer's** user document.
No rule permits that — not owner, not admin, not migrating — so the batch is
denied. CLAUDE.md lists the referral system as not yet built, so this is a trap
waiting for whoever builds it rather than a live bug. Any fix needs a rule that
permits a credit award to another user without opening arbitrary writes, which
realistically means a Cloud Function.

### N4. Async games can never reach `finished` (pre-existing app logic)

`GameView` shows "All caught up!" to every async player including the host, and
there is no control that calls `advanceQuestion`. The host branch is the only
path that may write `status`, so nothing moves an async game to `finished` and
`GameSummary` is unreachable. CLAUDE.md specifies async results reveal at
deadline or when all players finish. Predates the rules work; the rules change
does mean there is no client-side workaround.

### N5. Silent dead-ends across the game components (pre-existing pattern)

`handleFirestoreError` logs and rethrows without ever toasting. The rethrow
escapes async click handlers as an unhandled rejection: no toast, no error UI.
Affects `GamePlay` (both submit paths), `QuestionSubmission`, `GameLobby`,
`GameResults`, `GameHome` — roughly 20 call sites overall. Fixed locally in the
group-join modal this session; the general pattern remains.

Worst instance is the live-mode timeout in `GamePlay`: on a rejected write the
player is left staring at a 0s clock with no message. CLAUDE.md: "Every error
state must be clear and actionable — never a dead end." One fix at the helper
would cover all of them.

### N6. `game_questions` reveals authorship from write time (previously known)

`GameResults` renders "Submitted by {authorUsername}" on every per-question
results screen, and any player may read `game_questions` from submission
onward. CLAUDE.md says the author is revealed only on the final results screen.
Already tracked as an open issue; re-confirmed independently.

### N7. `isValidUser` is defined and never referenced

Dead validator in `firestore.rules`. The rules compiler warns about it on every
dry run. Either wire it into the `users` create path or delete it.

---

## Not touched, by instruction

`answers` and `predictions` remain readable by every player because they live
in the shared game document and Firestore has no field-level read control.
Proposal written to `docs/game-answers-privacy-proposal.md` — current gap, the
per-player subcollection schema, a `progress/{uid}` document so `resolvePhase`
can tell who has finished without learning what they chose, the scoring problem
that makes it non-mechanical, seven affected client files with risk ratings,
and migration risk. **Not implemented.**

Recommendation there is the callable Cloud Function option, which places it
behind Blaze with the other four queued items.

---

## Queue

1. Users-listability — `usernames/{lowercased}` lookup collection. Own branch.
2. Groups member-list redesign — `memberCount` + members subcollection. Own branch.
3. Admin moderation queue screen. Own branch.

### Note on item 1 scope, from tracing

Removing `allow list` from `users` needs **three** replacements, not one:

- `AuthProvider.tsx:105` — sign-in migration sweep, by username
- `AuthProvider.tsx:195` — signup orphan-profile lookup, by username
- `AuthProvider.tsx:314` — **referral redemption, by `referralCode`**

So it needs a `referralCodes/{code}` mapping alongside `usernames/{lowercased}`,
or referral redemption breaks. Existing accounts have neither mapping document,
so a backfill is required before `list` can be withdrawn.
