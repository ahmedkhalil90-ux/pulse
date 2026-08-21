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

### N8. 🔴 CRITICAL — the admin allow-list is a username anyone can register

**This is the most urgent item in this file. It is a product decision, so I
logged it rather than changing it.**

`isAdmin()` trusts `request.auth.token.email` against a fixed list that includes
`ak@pulse.app` and `ahmedkhalil90@pulse.app`. But `AuthProvider.signUp` builds
every credential as `` `${username.toLowerCase()}@pulse.app` ``. The token is
genuine; its contents are chosen by the person signing up.

So: **sign up with the username `ak`, and you are an admin.** No Firestore write
is needed to achieve it, and the `role` guard added this session is irrelevant
because the email branch short-circuits first.

Verified on the emulator with both usernames. As `ak@pulse.app` I set another
user's credits to 100000, added myself to a game in progress, and read that
game's `answers` and `predictions`.

Violates the first hard rule in CLAUDE.md, and every `isAdmin()` gate in the
file — including `allow delete` on `results/`, which the rules file itself
argues must never be possible because zeroing a results document and watching
the next vote land de-anonymises that voter.

Nothing in `src/` reserves these usernames. If `ak` and `ahmedkhalil90` are not
already registered to Ahmed, this is available to the first person who tries.

I did not fix it because every fix is a decision about who counts as an admin:
dropping the `@pulse.app` entries could lock Ahmed out of his own admin access,
and I cannot tell from the codebase which address he actually uses. The durable
fix is to stop deriving admin status from a self-chosen namespace — a custom
auth claim, or the hardcoded UID alone.

### N9. Lobby games are enumerable, and games have no invite-code proof

`allow read` on `games` releases any document with `status == 'lobby'`, so
`where('status','==','lobby')` returns them all, invite codes included. An
attacker joins uninvited, and once the host starts, they are inside the
document for the whole session.

Note the divergence this creates: **groups now require proof of the invite code
(`hasJoinProof`), games require nothing.** The same mechanism would work for
games — a `joinRequests` subcollection under the game, compared server-side.
That is the natural follow-up and would close this properly.

### N10. Any user can create a game enrolling a stranger

`games` create requires only `players.hasAll([self])`, so
`players: ['evil','victim']` is accepted. Victim UIDs are obtainable because
`users` is listable. `GameView` selects the victim's active game with
`array-contains` + `orderBy createdAt desc limit 1`, so the attacker's freshly
created game becomes the one the victim lands in, and they submit questions and
answers into a document the attacker hosts and reads.

Cannot be fixed by narrowing create to `players == [self]`: `GameSummary`'s
"play again" legitimately re-creates a game with the previous roster, and any
player can trigger it. The fix has to be invitation-shaped.

### N11. The host can rewrite `scores` arbitrarily, and `scores` leaks predictions

Two problems on one field.

*Tampering*: the host branch permits any `scores` value, so a host can zero
every rival. Rewinding `scoredQuestions` and `currentQuestionIndex` is also
permitted, which defeats the idempotency guard in `gameState.advanceQuestion`
and allows a question to be scored twice. Enforcing correct scoring in rules is
not feasible — this is an argument for scoring server-side (see the privacy
proposal's Option A).

*Leak*: `scores` sits in a document every player can read, and advances one
question at a time. A player's score rises by exactly 1 iff their prediction
matched the majority, and the majority is shown on the results screen. So
diffing `scores` across an advance discloses every other player's prediction,
question by question. **This is not covered by
`docs/game-answers-privacy-proposal.md`, which addresses only the `answers` and
`predictions` maps.** If that schema change lands, `scores` has to move with it
or the leak survives.

### N12. `questions` is append-only but not order- or content-safe

`hasAll` is containment, so reordering, duplication and padding are all
permitted. Reordering moves a chosen question to index 0. Appending an ID
belonging to a different game deadlocks the session, because `game_questions`
reads resolve `players` from that other game and every player gets
permission-denied with no way forward.

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
