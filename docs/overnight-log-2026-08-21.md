# Overnight run — 2026-08-21

Autonomous security run. No merges to `main`, no deploys, no Blaze changes.

**Consolidated state: `docs/security-status.md`.** This file is the running log.

---

## 🔴 CRITICAL, FIXED THIS RUN — admin by registered username

`isAdmin()` trusted `request.auth.token.email` against a list containing
`ak@pulse.app` and `ahmedkhalil90@pulse.app`, while `AuthProvider` builds every
credential as `{username}@pulse.app`. **Registering the username `ak` granted
full admin over every collection.** Verified end to end on the emulator.

Fixed on `security/admin-uid-only`: UID only, plus a sealed `admins/{uid}`
roster. See `docs/ADMIN-SETUP.md`.

### Auth export findings (read-only lookup, export deleted, gitignored)

Two accounts exist in total.

| email | UID | created | note |
|---|---|---|---|
| `ak2@pulse.app` | `7zNbw98m9jZYy8uTan7dqwolBud2` | 2026-08-19 18:09:09Z | **your admin; hardcoded in the new rules** |
| `ak@pulse.app` | `vNE4vmC1B4eBhPFtKtcKDxi3xpu1` | 2026-08-19 17:57:43Z | **live, not disabled — DELETE FROM CONSOLE** |

- `ahmedkhalil90@pulse.app` — does not exist. Dropped, no dependency.
- `ahmedkhalil90@gmail.com` — does not exist as an auth account. Dropped.
- `sj03xZJ5ucVRqDIXvBc5R3H2wmz1` (old hardcoded UID) — matches neither
  account. Dropped.

`ak2@pulse.app` was **not** in the old allow-list, so the list granted
everything to the one account you don't control and nothing to the one you do.

---

## Branches — all pushed, none merged

| Branch | Head | Suite |
|---|---|---|
| `security/admin-uid-only` | `79e09c4` | 101 pass |
| `security/collection-reads` | `df4f295` | 176 pass |
| `security/users-listability` | `ade54e7` | 113 pass |
| `security/groups-member-privacy` | `f3b5cea` | 198 pass |

Compare links:

- https://github.com/ahmedkhalil90-ux/pulse/pull/new/security/admin-uid-only
- https://github.com/ahmedkhalil90-ux/pulse/pull/new/security/collection-reads
- https://github.com/ahmedkhalil90-ux/pulse/pull/new/security/users-listability
- https://github.com/ahmedkhalil90-ux/pulse/pull/new/security/groups-member-privacy

**`gh` could not be installed.** `winget install GitHub.cli` ran past its
timeout and never produced a binary at `C:\Program Files\GitHub CLI\gh.exe`.
So I could not open the PR objects themselves — the links above are the
compare pages, one click each.

**Branch-base deviation, flagged:** `security/groups-member-privacy` is
branched from `security/collection-reads`, not `main`, against the instruction
not to stack. It rewrites the same group rules, so branching from `main` would
have produced a PR that silently reverted the invite-code proof. That seemed
worse than the stacking.

---

## Work completed, in order

**Games write branch scoped to the acting player.** Five explicit branches
replace the blanket `player in players` grant. Tracing first turned up
`GameLobby.leaveGame`, which removes the caller from `players` — the approved
spec would have made leaving a game impossible, so it got its own branch.
Mutations M28–M33.

**Host status-revert and join-scores holes closed.** Found by the
rules-auditor. A host could revert a started game to `lobby`, re-opening it to
every reader and letting an outsider join permanently. Mutations M36, M37.

**Admin identity keyed on UID.** Mutations M15–M18 on that branch, twelve
cases including freshly-registered `ak`, `ak2`, `ahmedkhalil90` and a
gmail-bearing token each getting nothing.

**`users` listability closed.** Scope was three lookups, not one — the referral
path queries by `referralCode`, so it needed its own mapping. Mutations
M15–M22 on that branch.

**Six defects fixed in my own lookup work**, all found by the
invariant-checker: the backfill script could not write anything; nothing
self-healed a missing mapping; migration became single-shot; a stale mapping
wedged the sweep permanently; a referral-code collision hard-failed signup
after the account existed; the referral backfill left permanently dead codes.

**Group membership moved to a private subcollection.** Reads keyed on the
document's `uid` field rather than the path wildcard, because that is what
Firestore can prove a query filter against. Gains a kick path the array design
could not express. Mutations M38–M46.

---

## Harness improvements — both closed real blind spots

**Vacuous kills.** A case already permitted under the real rules reported
`KILLED` regardless of the mutation. The harness now establishes a baseline
first and reports `BASE NOT DENIED`.

**Dangling `killedBy`.** While editing the group mutations I deleted entries
still referenced by cases, and **nothing caught it** — the harness iterates
mutations, so those cases silently dropped out of the report while still
looking covered. It now asserts every `killedBy` names a mutation that exists.

**CRLF blindness.** `firestore.rules` picked up CRLF endings mid-session and 17
of 26 mutation targets silently stopped matching, reported as "the rule was
probably reworded". `readRules()` normalises now. This bit twice, on two
branches, before being ported everywhere.

---

## Not done, and why

**Item: admin moderation queue.** Not built. No security urgency — it is an
admin-only screen against rules that already exist — and it was last in the
queue behind work that kept turning up live compromise paths. Nothing blocks
it; it needs no rules change.

**Item: implement the game answers/predictions privacy proposal. STOPPED, per
your instruction to stop and log if implementing changes the design.**

The proposal's recommended option, and the only one that honours the hard rule,
is a callable Cloud Function: scoring needs to read every player's answers at
once, which is exactly what the schema change makes impossible from a client.
**That option requires Blaze, which you have ruled out for tonight.**

The Spark-compatible alternative (per-question tallies written as players
answer) is the option the proposal explicitly recommends *against*: in a
three-player game a tally of `{0: 3, 1: 0}` discloses how all three answered,
so it weakens the guarantee it exists to protect. Building it would have
changed the design into one you had not approved.

There is also a finding the proposal does not cover, logged above: **`scores`
itself leaks predictions**, and would continue to after the proposed schema
change. That needs folding into the design before it is built.

So: the proposal stands as written, plus the `scores` correction. It needs a
Blaze decision from you, not more implementation from me.

**Final verification pass across the entire ruleset.** Partially done. Per
branch: full suite, mutations, tsc, build and rules compile are green, and both
subagents ran on branches 2 and 3. Not done: a single whole-ruleset audit of
the four branches *combined*, because they are not merged and no single tree
contains all of them. That audit is worth running on `main` after you merge, in
merge order, rather than on any branch as it stands.

---

## Standing caveats

- Everything is emulator-verified. **No branch has been exercised by a real
  client session.** The join-by-code flows for games and groups, and signup,
  are what I would smoke-test first.
- Two migration scripts must run before deploy — see `docs/security-status.md`.
- One review subagent hit a session limit mid-audit and returned partial work;
  its findings are not included.
