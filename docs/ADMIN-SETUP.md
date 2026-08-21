# Admin setup — what to create by hand

Read this before deploying `security/admin-uid-only`.

## What changed

`isAdmin()` no longer looks at email addresses or at `users/{uid}.role`. It
keys on UID only:

```
function isAdmin() {
  return isAuthenticated() &&
     (request.auth.uid == "7zNbw98m9jZYy8uTan7dqwolBud2" ||
      exists(/databases/$(database)/documents/admins/$(request.auth.uid)));
}
```

## You do not need to create anything to keep your access

`7zNbw98m9jZYy8uTan7dqwolBud2` is **ak2@pulse.app**, confirmed from
`firebase auth:export` on 2026-08-21. It is hardcoded, so your admin access
survives this deploy with no manual step. The test
`the real admin UID has admin powers` asserts exactly this UID against the real
ruleset, so if it ever stops matching, the suite fails rather than locking you
out silently.

## To grant admin to anyone else

Create, in the Firestore console:

- **Collection:** `admins`
- **Document ID:** the person's Firebase Auth UID — exactly, no `@pulse.app`,
  no username
- **Fields:** none are required. The rule only checks that the document
  exists. A `note` string is useful for your own records.

Example:

| | |
|---|---|
| Collection | `admins` |
| Document ID | `7zNbw98m9jZYy8uTan7dqwolBud2` |
| Field | `note` (string) = `"ak2 — primary"` |

Adding that document is optional for ak2 specifically, since the UID is already
hardcoded. It is the only mechanism for anyone else.

## Why the console, and not the app

`match /admins/{adminUid} { allow read, write: if false; }` — the collection is
sealed from every client, in both directions.

- **No client can write it**, so nobody can grant themselves admin, and a
  compromised admin session cannot mint more admins.
- **No client can read it**, so admins cannot be enumerated before being
  targeted.

`get()` and `exists()` inside security rules are not subject to the rules of
the path they read, so `isAdmin()` still works. Writes are console or Admin SDK
only, which is deliberate.

## Action required from you, separately

**Delete `ak@pulse.app` (UID `vNE4vmC1B4eBhPFtKtcKDxi3xpu1`) from Firebase
Auth.** It exists, is not disabled, and was created 2026-08-19 17:57:43 UTC —
about eleven minutes before ak2. Under the old rules it held full admin. This
change removes that, but the account still exists and can still sign in as an
ordinary user.

`ahmedkhalil90@pulse.app` and `ahmedkhalil90@gmail.com` do not exist as auth
accounts, and the previously hardcoded UID
`sj03xZJ5ucVRqDIXvBc5R3H2wmz1` matches neither account. All three were dropped
with no live dependency.

## Note on `users/{uid}.role`

The field is no longer consulted by any rule, so writing it grants nothing.
Nothing in `src/` reads or writes it. It can be deleted from any profile that
carries one; leaving it is harmless.
