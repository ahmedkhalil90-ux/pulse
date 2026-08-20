# Proposal: game answers and predictions are visible to every player

**Status: proposal only. Nothing here is implemented. Needs Ahmed's review before any code is written.**

Written 2026-08-20, during the overnight security run on `security/collection-reads`.

---

## The gap

CLAUDE.md states two hard rules:

> In groups and game mode, no player can ever see another player's specific answer.

> Game predictions are stored privately, never exposed.

Neither holds today, for players. They now hold for non-players — that was fixed
this session — but the fix does not and cannot reach inside the game document.

`games/{gameId}` carries two maps keyed by player UID (`src/types.ts:75-91`):

```ts
predictions: Record<string, Record<string, number>>; // playerUid -> questionId -> optionIndex
answers:     Record<string, Record<string, number>>; // playerUid -> questionId -> optionIndex
```

The read rule grants a player the **whole document**:

```
allow read: if isAuthenticated() && (
              request.auth.uid in resource.data.players ||
              resource.data.status == 'lobby'
            );
```

Firestore has no field-level read control. A document is returned in full or not
at all. So any player can open the browser console, read the game document
directly, and see exactly how every other named player answered and predicted,
question by question — including in a live game, before results are shown.

The UI never displays this. That is the only thing protecting it, and the app's
core promise is that anonymity is enforced by the data layer rather than by what
the interface chooses to render.

### What was fixed this session, and what it did not fix

| Vector | Before | Now |
|---|---|---|
| Non-player reads a game in progress | Open to any authenticated user | Closed — reads limited to players and lobby games |
| Non-player joins an active game, then reads | Open | Closed — join requires `status == 'lobby'`, and status cannot move backwards |
| A player adds an outsider, who then reads | Open | Closed — `players` is immutable outside join/leave |
| Host reverts status to `lobby`, re-opening the document | Open | Closed — `gameStatusOk()` allows only lobby → active → finished |
| Anyone registers the username `ak` and is treated as admin | Open | **Still open — see the overnight log, N8. Highest priority.** |
| One player writes another's answer | Open | Closed — `ownKeyOnly` pins map writes to the caller |
| **A legitimate player reads every other player's answers** | **Open** | **Still open — this proposal** |

The first four were rules problems. This one is a schema problem, and no rule
change fixes it.

---

## Proposed schema

Move the per-player maps out of the shared document into subcollections whose
document IDs are player UIDs, so a rule can gate them per player.

```
games/{gameId}
  ├─ (unchanged) type, status, hostUid, players, questions,
  │   currentQuestionIndex, inviteCode, questionsPerPlayer, createdAt,
  │   deadline, scores, scoredQuestions, lastUpdated
  ├─ answers/{playerUid}       ← NEW   { <questionId>: optionIndex, ... }
  ├─ predictions/{playerUid}   ← NEW   { <questionId>: optionIndex, ... }
  └─ progress/{playerUid}      ← NEW   { answered: [qid], predicted: [qid] }
```

`answers` and `predictions` are removed from the game document entirely.
`scores` stays where it is — aggregate points are meant to be public within the
game; that is the leaderboard.

### Why `progress` is needed

`GameView.resolvePhase` currently decides what screen to show by reading every
player's answers out of the shared document:

```ts
const allFinished = activeGame.players.every(pUid =>
  activeGame.answers?.[pUid]?.[currentQuestionId] !== undefined &&
  activeGame.predictions?.[pUid]?.[currentQuestionId] !== undefined
);
```

Once answers are private, that check cannot run client-side. `progress/{uid}`
holds only *which questions this player has finished* — never *what they chose*.
Every player may read every `progress` document; that discloses completion, not
content, which is what the "waiting for other players" UI legitimately needs.

### Rules sketch

```
match /games/{gameId}/answers/{playerUid} {
  // Write your own only, and only while you are a player in the game.
  allow create, update: if isOwner(playerUid)
                        && request.auth.uid in
                             get(/databases/$(database)/documents/games/$(gameId)).data.players;
  // Read your own only. Never anyone else's, at any point, including after
  // the game finishes -- the results screen shows aggregates, not choices.
  allow read: if isOwner(playerUid);
  allow delete: if false;
}

match /games/{gameId}/predictions/{playerUid} {
  // Identical, with one difference: predictions are never readable by anyone
  // else even in aggregate, per CLAUDE.md.
  allow create, update: if isOwner(playerUid)
                        && request.auth.uid in
                             get(/databases/$(database)/documents/games/$(gameId)).data.players;
  allow read: if isOwner(playerUid);
  allow delete: if false;
}

match /games/{gameId}/progress/{playerUid} {
  allow read: if isAuthenticated()
              && request.auth.uid in
                   get(/databases/$(database)/documents/games/$(gameId)).data.players;
  allow create, update: if isOwner(playerUid);
  allow delete: if false;
}
```

---

## The hard part: scoring

This is the reason the change is not mechanical, and the main thing needing a
decision.

`scoreQuestion` (`src/lib/gameScoring.ts`) tallies every player's answer to find
the majority, then awards a point to each player whose prediction matched. It
needs to read **all** answers and **all** predictions at once. Under the schema
above, no client can do that — which is the entire point.

Three options, in the order I would rank them:

### Option A — a callable Cloud Function (recommended)

The host calls `advanceQuestion(gameId, questionId)`. The function runs with
Admin SDK privileges, reads every `answers/{uid}` and `predictions/{uid}`
document, computes the majority and the new scores, and writes only `scores`,
`scoredQuestions`, `status` and `currentQuestionIndex` back to the game
document. No client ever holds another player's choice.

- Correct, and the only option that fully honours the hard rule.
- **Requires the Blaze plan.** This joins the four items already queued behind
  it, and should ship in the same Cloud Functions codebase.
- `src/lib/gameState.ts:advanceQuestion` becomes a thin `httpsCallable` wrapper.
  Its idempotency guard (`scoredQuestions`) moves server-side, where it is
  stronger — the transaction and the authority to read all answers live in the
  same place.

### Option B — per-question aggregate written as players answer

Each answer write also increments a counter on
`games/{gameId}/tallies/{questionId}` — `{ counts: { '0': n, '1': n } }` —
readable by all players. Scoring then reads tallies rather than answers.

- Works on the Spark plan, today.
- Reintroduces exactly the vote-integrity problem `results/` already has: rules
  would have to verify each increment against the caller's own private answer
  document, which is doable (`get()` on `answers/{uid}`) but adds a second
  fiddly rule surface, and it is replay-able the same way `results/` is
  (open finding 6).
- With few players a tally is close to disclosive anyway: in a 3-player game,
  `{0: 3, 1: 0}` tells everyone how all three answered. **This option weakens
  the guarantee it is meant to protect**, and I would not choose it.

### Option C — resolve at deadline, client-side, after the fact

Keep answers private until the game finishes, then open reads.

- Simplest, and wrong. It converts "never visible" into "visible slightly
  later", which is not what the hard rule says.
- Listed only so the option is on the record as considered and rejected.

**Recommendation: Option A, deferred until Blaze.** Until then the gap is real
but bounded — it needs a participant in your game, acting deliberately through
the console. Worth writing into CLAUDE.md's open issues at position 1 with that
caveat, rather than shipping Option B as a stopgap that quietly lowers the bar.

---

## Client components that would change

| File | Change | Risk |
|---|---|---|
| `src/components/GameMode/GamePlay.tsx` | `submitAnswer` / `submitPrediction` write to `answers/{uid}` and `predictions/{uid}` instead of dotted paths on the game doc; also update `progress/{uid}` | Low — two isolated writes |
| `src/components/GameMode/GameView.tsx` | `resolvePhase` reads `progress/*` rather than `answers`/`predictions`; needs a new subscription | **High — this is the state machine.** Every phase transition routes through it |
| `src/lib/gameState.ts` | `resolvePhase` signature takes progress documents; `advanceQuestion` becomes a callable wrapper under Option A | High — engine code, fully covered by `tests/game.test.ts` |
| `src/lib/gameScoring.ts` | Under Option A, moves server-side; the pure functions can be shared verbatim | Medium — pure and well tested, so portable |
| `src/components/GameMode/GameResults.tsx` | `myPrediction` reads the caller's own document; the percentage bars need the tally or the function's response | Medium — display logic plus one read |
| `src/components/GameMode/GameSummary.tsx` | `perfectlyDividedQuestions` currently recomputes from `game.answers`; needs server-provided per-question outcomes | Medium — currently derives from data it will no longer have |
| `src/types.ts` | Drop `answers` / `predictions` from `Game`; add the subcollection types | Low, but it will surface every reader at compile time — useful |

`GameView.tsx` and `GameSummary.tsx` are the two that worry me. Both derive
displayed state from the full answer map today.

---

## Migration risk

- **In-flight games break.** A game mid-play has answers in the old location and
  none in the new one. Options: let existing games finish on the old schema with
  a version flag on the document, or accept that beta games are disposable and
  delete them. Given pre-beta with a small user base, **deleting in-flight games
  at cutover is cleaner** than dual-reading — but it is your call, not mine.
- **No backfill path for privacy.** Copying historical answers into
  subcollections preserves data that arguably should never have been jointly
  readable. Consider not migrating history at all.
- **Rules and schema must land together.** The subcollection rules are inert
  until clients write there, and the clients break the moment `answers` leaves
  the game document. This is one deploy, not two, and it is not reversible
  without a matching client rollback.
- **Read-count cost.** `resolvePhase` currently reads one document. Afterwards
  it reads one `progress` document per player, per evaluation. For an 8-player
  live game that is 8 reads on every phase check. Worth a listener on the
  subcollection rather than per-player `getDoc` calls.
- **The `game_questions` authorship leak is adjacent and unfixed.**
  `game_questions` carries `authorUsername` and is readable by every player from
  write time, though CLAUDE.md says the author is revealed only on the final
  results screen. It is a separate open issue, but it touches the same
  components — worth doing in the same pass rather than opening game mode twice.

---

## What I would want before building this

1. A decision on Option A vs B, which is really a decision on whether this waits
   for Blaze.
2. A decision on in-flight games: version flag, or delete at cutover.
3. Confirmation that `scores` staying public in the game document is correct —
   the leaderboard implies yes, but it is the one per-player number that would
   remain readable, and I would rather ask than assume.
