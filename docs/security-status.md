# Security status — 2026-08-21

Every finding from the security work to date, with its current state.

**Nothing is merged, deployed, or on Blaze.** Five branches are pushed and
waiting. Merge order matters — see the bottom of this file.

---

## Branches, in the order they should be merged

| # | Branch | What it does | Suite |
|---|---|---|---|
| 1 | `security/admin-uid-only` | Admin keys on UID only. **Merge first.** | 101 pass |
| 2 | `security/collection-reads` | Game reads, group updates, results reads, invite-code proof | 176 pass |
| 3 | `security/users-listability` | `users` no longer listable; lookup collections | 113 pass |
| 4 | `security/groups-member-privacy` | Membership subcollection + `memberCount` | 198 pass |

Compare links are in `docs/overnight-log-2026-08-21.md`.

Branch 4 is stacked on branch 2, deliberately — it rewrites the same group
rules, and branching it from `main` would have produced a PR that silently
reverted the invite-code proof. Branches 1 and 3 are independent of `main`.

---

## FIXED — verified on the emulator, with a mutation proving each test bites

### Critical

**Admin by registered username.** `isAdmin()` trusted `token.email` against a
list containing `ak@pulse.app`; signup builds every credential as
`{username}@pulse.app`, so registering the username `ak` granted full admin
over every collection. Verified: set another user's credits to 100000, joined a
game in progress, read its answers and predictions. Now keyed on UID alone plus
a sealed `admins/{uid}` roster. → branch 1

**Admin by self-written field.** `isAdmin()` also trusted `users/{uid}.role`,
which the owner writes to their own profile. Removed. → branch 1

**Game answers and predictions readable by any signed-in user.** Reads now
limited to players, plus lobby games so joining by code works. → branch 2

**Self-join into a game in progress.** The join branch had no status check, so
anyone with a game ID could add themselves and then satisfy the read rule. Now
lobby-only and pinned to the caller. → branch 2

**Host could re-open a started game.** `status` was writable to any value, so a
host could revert to `lobby` — re-opening the document to every reader and
letting an outsider join — then set it back. Status now moves forward only. →
branch 2

### High

**Any player could write any game field**, including another player's answers,
the scores map, and the roster. Five explicit branches now. → branch 2

**Any authenticated user could modify any group** — rename, reassign admin,
rotate the invite code, remove members. → branch 2

**Invite codes did not gate membership.** Joining checked only the shape of the
members change. A proof document now carries the code and is validated
server-side against the group. → branch 2

**`users` listable by any authenticated user**, leaking every username with
demographics and credit balance. `list` is admin-only; three dependent lookups
moved to `usernames/` and `referralCodes/` mappings. → branch 3

**Group rosters readable by anyone signed in.** Membership moved to a
per-member subcollection; the group carries `memberCount`. → branch 4

**Vote integrity, flagging, boosting, UID-migration takeover, answer-record
ownership** — all covered earlier in this work, 39 rules tests with mutations.

**Six credit bugs** — boost/unlock overdraft, non-atomic boost, unlock
double-charge and race, daily-bonus double-award.

**Game scoring double-count** — advancing is idempotent per question.

### Defects introduced by this work and then fixed

Listed because they show what the review passes caught:

- The `role` guard covered `update` but not `create`, so a profile could be
  created holding `role: 'admin'`, or deleted and re-created elevated. The
  suite reported it closed because every case tested an update.
- `allow update: if false` on the join proof locked users out of rejoining
  permanently — `setDoc` over an existing document is an update.
- The join proof was accepted on existence alone, surviving a code rotation.
- The backfill script could not write a single mapping it existed to write.
- Migration became single-shot; a transient failure stranded an orphan forever.
- A referral-code collision hard-failed signup after the account already
  existed, leaving the user able to neither sign up nor sign in.

---

## OPEN — not fixed

### Needs your decision

**`ak@pulse.app` still exists in Firebase Auth.** UID
`vNE4vmC1B4eBhPFtKtcKDxi3xpu1`, created 2026-08-19 17:57:43 UTC, not disabled.
Branch 1 removes its admin powers but cannot delete the account. **Delete it
from the console.**

**A player can rewrite their own answer after seeing the split.** `ownKeyOnly`
pins which key changes, not the value, and the results screen renders before
the host advances. Flips the majority and everyone's score. Game integrity, not
anonymity. Fix belongs in the player branch: require the per-question entry to
be absent. Care needed around the live-mode timeout, which writes `-1`.

**The host can rewrite `scores` arbitrarily**, and rewinding `scoredQuestions`
defeats the idempotency guard. Enforcing correct scoring in rules is not
feasible — this is an argument for scoring server-side.

**`scores` leaks predictions.** It sits in a document every player reads and
advances one question at a time; a score rising by exactly 1 iff the prediction
matched the shown majority means diffing across an advance discloses every
player's prediction. **Not covered by the privacy proposal**, which addresses
only the answers and predictions maps. If that schema change lands, `scores`
must move with it.

**Lobby games are enumerable and games have no invite-code proof.** Groups now
require proof; games require nothing. The same `joinRequests` mechanism would
close it.

**Anyone can create a game enrolling a stranger.** `players.hasAll([self])`
constrains only that the creator is present. Cannot be fixed by narrowing to
`players == [self]` — "play again" legitimately re-creates a roster. Needs an
invitation-shaped fix.

**`game_questions` reveals authorship from write time**, though CLAUDE.md says
the author is revealed only on the final results screen.

**`awardReferral` cannot succeed.** It updates the *referrer's* user document,
which no rule permits. Referrals are unbuilt, so this is a trap rather than a
live bug, but the write half needs a rules decision.

**Async games can never reach `finished`.** Nothing calls `advanceQuestion` for
them, and the host branch is the only path that may write `status`.

**~20 silent dead-end catch blocks.** `handleFirestoreError` logs and rethrows
without ever toasting; the rethrow escapes async click handlers. Worst instance
is the live-mode timeout, which leaves the player at a 0s clock with no
message. Fixed locally in the group-join modal only.

**`questions` is append-only but not order- or content-safe.** Reordering moves
a chosen question to index 0; appending an ID from another game deadlocks the
session.

**`isValidUser` and `isSystem` are defined and never referenced.**

### Blocked on Blaze

- Results min-10 threshold and the 3-credit unlock — rules cannot apply a
  threshold to a map read.
- Gemini key in the client bundle.
- Vote replay — a genuine answerer can repeat the `results` +1 indefinitely.
- Password recovery — synthetic addresses cannot receive reset mail.

---

## ACCEPTED RISK

**Any player can read every other player's answers and predictions.** They live
in the shared game document and Firestore has no field-level read control, so
no rule change fixes it. Closed against non-players and against self-join
escalation; open to a legitimate participant acting through the console.
`docs/game-answers-privacy-proposal.md` has the schema fix. See the note below
on why it was not implemented.

**Group and game documents remain enumerable by any signed-in user**, so invite
codes are discoverable. The write-side proof raises the cost but does not close
it while the read side is open.

---

## What I would not sign off on

**Deploying any of this without running the two migration scripts first.**
`scripts/backfill-lookups.ts` and `scripts/migrate-group-members.ts`. The
groups one in particular must run *before* the new rules are live: afterwards a
group whose `memberCount` disagrees with its membership documents cannot be
corrected from any client.

**Merging branches 2–4 before branch 1.** They all rely on `isAdmin()`, and
until branch 1 lands anyone can be an admin by registering a username.

**The claim that the app's anonymity promise is met.** It is not, for players
inside a game, and `scores` leaks predictions even after the proposed schema
change. Both need your decision.

**Any of this on real user data without a smoke test.** Everything here is
verified against the emulator. No branch has been exercised by a real client
session.
