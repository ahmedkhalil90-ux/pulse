# Security status — 2026-08-21

Every finding from the security work to date, with its current state.

**Nothing is merged, deployed, or on Blaze.** Nine branches are pushed and
waiting. Merge order matters — see the bottom of this file.

---

## Branches, in the order they should be merged

| # | Branch | What it does | Suite |
|---|---|---|---|
| 1 | `security/admin-uid-only` | Admin keys on UID only. **Merge first.** | 101 pass |
| 2 | `security/collection-reads` | Game reads, group updates, results reads, invite-code proof | 176 pass |
| 3 | `security/users-listability` | `users` no longer listable; lookup collections | 113 pass |
| 4 | `security/groups-member-privacy` | Membership subcollection + `memberCount` | 198 pass |
| 5 | `security/answer-immutability` | Recorded answers/predictions are append-only | 205 pass |
| 6 | `ui/error-feedback` | Firestore errors reach the user instead of dead-ending | 205 pass |
| 7 | `security/game-author-privacy` | Question authorship hidden until the game finishes | 220 pass |
| 8 | `security/question-list-integrity` | Question submission bounded; game screens no longer spin forever | 225 pass |
| 9 | `feature/moderation-queue` | Admin review of questions held at `pending` | 230 pass |

Compare links are in `docs/overnight-log-2026-08-21.md`.

Branch 5 is stacked on branch 4, and branch 6 on branch 5, because each
builds on rules the previous one introduces. Branch 6 also carries branch 5.

Branch 4 is stacked on branch 2, deliberately — it rewrites the same group
rules, and branching it from `main` would have produced a PR that silently
reverted the invite-code proof. Branches 1 and 3 are independent of `main`.

---

## Merge playbook — from a trial merge of all four

I merged all four locally to find out what breaks. **Two problems were found
and fixed at the source**, so the branches as they now stand are better than
they were; what follows is what still needs a human at merge time.

### Fixed already, no action needed

**Mutation IDs collided.** Three branches independently allocated M15–M22 to
different rules — `M15` meant "any user may read any game", "any user is an
admin", and "users is listable again" on three different branches. Merged, the
array would have held duplicate ids, and the harness resolves by first match,
so cases would have verified against the wrong rule and reported green. Admin
mutations moved to M50–M53, lookup mutations to M60–M67, and the harness now
**fails on any duplicate id** and on any `killedBy` naming a mutation that does
not exist.

**Two cross-branch breakages**, each invisible until combined:

- `M60`'s target included `allow create: if true;`, which branch 1 replaces —
  so the mutation silently stopped matching. Re-anchored.
- The `usersRole` cases used an email-based admin, which branch 1 removes. The
  actor now carries the real admin UID too, so it holds either way.

### Conflicts you will still hit, and how to resolve each

**Merging branch 1 into `main`: clean.**

**Merging branch 2:** conflicts in `tests/helpers/env.ts`,
`tests/helpers/suites.ts`, `tests/helpers/mutations.ts`.

- `env.ts` — a one-word comment difference. Take either side.
- `suites.ts` — both branches add imports and suite entries. **Keep both sides.**
- `mutations.ts` — both add entries. **Do not resolve by naive union**: the
  entries interleave and split an object mid-literal, which `tsc` catches but
  only after a confusing error. Take one side's file wholesale, then re-insert
  the other side's block before the closing `];`.

**Merging branch 3:** the important one — `firestore.rules`, in the
`users/{userId}` block.

Both branches rewrite it. **Taking either side alone loses a security fix.**

- Branch 1's side has the `role` guard on `create` and `update`.
- Branch 3's side has the `get`/`list` split that withdraws listability, but
  carries the *old* `allow create: if true`.

The correct resolution keeps `allow get` and `allow list` from branch 3, and
`allow create`/`allow update` from branch 1:

```
      allow get: if isAuthenticated();
      allow list: if isAdmin();
      allow create: if isOwner(userId)
                    && (!request.resource.data.keys().hasAny(['role']) || isAdmin());
      allow update: if (isOwner(userId) || isAdmin() || isMigrating(userId))
                    && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['role'])
                        || isAdmin());
      allow delete: if isOwner(userId) || isAdmin() || isMigrating(userId);
```

Same three test-helper conflicts as branch 2, resolved the same way.

**Merging branch 4:** one conflict in `tests/mutation.test.ts`, where both
sides add a guard block. Keep the version containing
`has no duplicate mutation ids` — it supersedes the other.

### What the merged tree looked like

Rules compiled, build clean, **243 of 245 tests passing** — the two failures
being exactly the cross-branch breakages described above, both since fixed at
source. **I did not re-run the full merged verification after those fixes**, so
treat "245 green" as expected rather than demonstrated. Run the suite once
after merging before you deploy.

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

**A player could rewrite their own answer after seeing the split**, moving the
majority and rewriting every score, because the results screen renders before
the host advances. Recorded answers and predictions are now append-only.
→ branch 5

**Question authorship was visible from submission**, though CLAUDE.md says the
author is revealed only on the final results screen. Attribution moved to
`game_question_authors`, readable only once the game is finished. → branch 7

**Question submission was unbounded** — the list could be reordered,
duplicated, padded, or submitted twice. Now bounded to the per-player quota,
once. **Partial**: reordering during a genuine submission is still possible,
because rules cannot compare list positions. → branch 8

**No admin moderation queue** — questions held at `pending` were invisible and
nothing reviewed them. Built, admin-gated by the rules rather than by a
client-side claim. → branch 9

**~20 silent dead-end catch blocks.** `handleFirestoreError` logged and threw;
the throw escaped async click handlers as an unhandled rejection, so a failure
showed the user nothing at all. It now toasts and returns. Several call sites
had recovery code after it that was unreachable and now runs. → branch 6

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
