# Pulse — Review & Test Automation

## Install

From `C:\pulse`, create the folders and drop the files in:

```powershell
mkdir .claude\agents
```

- `rules-auditor.md` → `.claude\agents\rules-auditor.md`
- `invariant-checker.md` → `.claude\agents\invariant-checker.md`
- `test-runner.md` → `.claude\agents\test-runner.md`
- `settings.json` → `.claude\settings.json`
- `guard-rules.js` → `.claude\guard-rules.js`

Then commit:

```powershell
git add .claude
git commit -m "Add review subagents and guard hooks"
```

Restart Claude Code so it picks up the new config. Verify with `/agents` — all three should be listed.

## Using them

Invoke explicitly with `@rules-auditor`, `@invariant-checker`, `@test-runner`, or let Claude Code delegate on its own. Each runs in its own context window, so a verbose test run or a full rules read doesn't crowd out your main session.

The pattern that replaces you-as-middleman:

1. Give Claude Code a task
2. It implements
3. `@test-runner` verifies
4. `@rules-auditor` or `@invariant-checker` reviews, depending on what changed
5. You read one summary and decide

## What the hooks do

**PostToolUse** runs `tsc --noEmit` after every file edit. A type error surfaces immediately rather than three edits later.

**PreToolUse** runs `guard-rules.js` before every Bash command, blocking force push, hard reset, `rm -rf`, live `firebase deploy`, and Firestore data deletion. These are the commands that lose work irreversibly. `--dry-run` deploys are allowed, so rules can still be compile-checked.

Hooks are shell scripts, not model judgment. They cannot be reasoned out of blocking.

---

## Build the test suite

This is the missing piece. Without it, the reviewers have no oracle and CI has nothing to run. Give this to Claude Code as a single task:

> Set up Vitest with @firebase/rules-unit-testing, wired to the Firestore emulator. Java is installed. Add an `npm test` script.
>
> Write security rules tests covering these cases. Each must assert the stated outcome:
>
> **results/{questionId}**
> - First vote creates the doc with exactly one vote — PASS
> - Vote without a matching user_answers record — FAIL
> - Vote incrementing the option the caller did NOT record — FAIL
> - Any decrement of either count — FAIL
> - Increment of another user's demographic bucket — FAIL
> - Adding a field beyond counts and demographics — FAIL
> - Second voter incrementing by exactly one — PASS
>
> **questions/{questionId}**
> - Flag by a non-author, +1 with one reason counter — PASS
> - Flag by the author — FAIL
> - Setting flags to 0 — FAIL
> - Setting status to 'live' by a non-admin — FAIL
> - Setting status to 'flagged' below the threshold — FAIL
> - Boost by the author, exactly +100 — PASS
> - Boost by a non-author — FAIL
> - Migration write that also changes text — FAIL
>
> **isMigrating**
> - Caller whose auth token email matches the target's username — PASS
> - Caller who set their profile username to match but whose token does not — FAIL
>
> **user_answers/{answerId}**
> - Owner updating their own answer (revisit) — PASS
> - Updating a record belonging to another user — FAIL
> - Changing questionId on an existing record — FAIL
>
> Verify each test actually fails when its rule is removed. Temporarily loosen each rule, confirm the corresponding test goes red, restore it. Report the result of that verification — a test that passes with or without its rule is worse than no test.

The verification step is the part that matters. Do not skip it.

---

## Open findings — not yet fixed

Carried forward from the security session. None of these are in the current rules.

**1. Game answers and predictions are readable by anyone.** `games/{gameId}` allows read to any authenticated user, and those documents contain `answers` and `predictions` maps keyed by player UID. Any logged-in user can read any game and see how each named player answered and predicted. Directly contradicts the CLAUDE.md rule that individual answers are never shown and predictions never exposed. **Highest priority.**

**2. The minimum-10 threshold is not enforced.** `results/{questionId}` allows read unconditionally — no auth required. The raw demographic map is public, so both the 10-response threshold and the 3-credit unlock are cosmetic.

**3. Any authenticated user can modify any group.** `groups/{groupId}` allows update with no membership check. Add yourself to a group you were never invited to, remove members, rename it. Read is also open to all authenticated users, exposing the full member UID list.

**4. Every user document is publicly listable.** `match /users` allows list unconditionally, dumping every username with age range, gender, country, and credit balance.

**5. Vote replay.** A user who genuinely answered can repeat the `results` +1 update indefinitely. Rules cannot detect a replay; needs a server-side transaction.

**6. Gemini key ships in the client bundle.** Interim state for beta. Real fix is a Cloud Function, which needs the Blaze plan. Must be resolved before public launch.

**7. No password recovery.** Accounts use synthetic `username@pulse.app` addresses that cannot receive email. A user who forgets their password loses their account, credits, and history permanently.

**8. No admin moderation queue.** Questions now correctly fail closed to `pending`, but nothing reviews them. If the Gemini key is misconfigured, every new question accumulates in that state invisibly.

Take these in order. Add each to CLAUDE.md's known-issues section as it's fixed or consciously deferred.
