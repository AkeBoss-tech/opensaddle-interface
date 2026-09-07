# Interface #36 controlled stale-response regression receipt

This is a controlled mutation of the current implementation, not a claim that the current mounted suite can be executed unchanged against a historical commit. The original surface and mounted suite entered Git together in repair commit `9c293ba23993daa8222f9aeb0e66be68ab77b74b`.

## Reproducible command

```sh
node scripts/verify-command-center-stale-response-mutation.mjs
```

The runner copies the production surface and mounted suite to temporary sibling files, removes only these current protections, runs the real mounted suite, and deletes both temporary files in a `finally` block:

- successful-response generation equality check
- error-response generation equality check
- render-time client and identity fence

Observed output on 2026-09-07:

```json
{
  "controlledMutation": true,
  "historicalReproduction": false,
  "testFile": "src/features/command-center/CommandCenterPage.mounted.test.tsx",
  "mutatedFences": [
    "success generation fence",
    "error generation fence",
    "render-time identity/client fence"
  ],
  "processExit": 1,
  "reproducedFailures": [
    "replacement client success and error both fence the earlier connection",
    "overlapping refreshes retain only the latest result or error"
  ]
}
```

## Repaired implementation

The owning repaired suite was then run without mutation:

```sh
node --import tsx --test \
  src/features/command-center/CommandCenterPage.mounted.test.tsx \
  src/features/command-center/CommandCenterPage.test.ts \
  src/services/remoteCommandCenter.test.ts
```

Result: 9 passed, 0 failed. This covers deferred disconnect, client replacement with stale success and error, overlapping refresh ordering, StrictMode/unmount/reopen, render-time replacement, route binding, transport mapping, unavailable errors, and exact Goal states.

The broader feature suite at the immediately preceding checkpoint reported 130 passed, 0 failed, with TypeScript, Electron build, application build, and diff checks passing. This receipt establishes the requested RED/GREEN behavior for the precise stale-response guards; it does not add backend authorization or production deployment claims.
