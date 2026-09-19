# Canonical native renderer state receipt

Captured on 2026-09-07 against the disposable Core fixture at `127.0.0.1:8909` and Interface at `127.0.0.1:4177`. Authentication came from the fixture's private mode-0600 token path. No token value was printed, placed in a command argument, saved in a screenshot, or written to this repository.

## Exact authority

- Project: `renderer-proof`
- Application / instance: `review-evidence` / `review-main`
- Resource: Run `run_8309c58135b74c61a195e6b2daa2df4f`, artifact `art_de57a306345c4f5db68ccb4a3bf43613`, digest `349b85b42d7c1c3aec2550e9b7429a68d894dafd08b7cf2efad2c12c81eaaa1d`
- Selected v1 package: `dev.opensaddle.fixture-renderer@1.0.0`, manifest `9c55842d5b2a1b9dd99088e84b9386d697b6042736909ce6753122d63bb535fa`
- Replacement v2 manifest: `f100689ed7be3d481393e55f273265e4ecd2040b975131307a0392e7f4006819`, content `e50c08abe16a1be11edd9a6bd23ee449ab84e4fc609aa5d9ae193cb60f33b46d`

## Native interaction

The isolated Electron renderer was selected through its own CDP target. The main shell was selected through the separate `http://127.0.0.1:4177` target. The following values are the returned DOM projections from those targets.

1. In v1, enter `filter=migration-proof` and `note=exact-v1`, then activate **Save fixture state**.
2. In the shell, activate **Replace with Fixture review renderer 2.0.0**. Core performs exact enablement CAS and Environment preview/apply before the host loads the replacement.
3. The v2 native DOM returned:

   ```json
   {"query":"migration-proof","note":"exact-v1","view":"review"}
   ```

   This proves the signed `filter` to `query` rename, preservation of `note`, and signed `view=review` default in the actual native process.
4. Change and save v2 state as `query=changed-v2`, `note=v2-only`, `view=focus`.
5. Send the CDP `Page.crash` command to the native renderer target. The shell remained responsive and rendered **The replacement did not become ready in the desktop host** with **Restore previous version**.
6. Activate **Restore previous version**. Core restores the prior exact package/application definition through current Environment CAS. The replacement host loaded v1 and its native DOM returned:

   ```json
   {"filter":"migration-proof","note":"exact-v1"}
   ```

   The v2-only values did not cross into v1. Rollback used the exact saved v1 snapshot rather than a guessed inverse migration.

## Visual and runtime boundaries

- [Desktop shell report](../screenshots/application-state-migration-core8909-desktop-shell-2026-09-07.png)
- [Desktop lifecycle section](../screenshots/application-state-migration-core8909-desktop-lifecycle-2026-09-07.png)
- Chromium `Page.captureScreenshot` of the shell does not composite the separate native `WebContentsView`; the native proof above is an exact CDP DOM receipt, not a combined-window screenshot.
- Core runtime health was still unavailable in this fixture. The shell's ready/error status was local host evidence and did not claim semantic correctness.
- This fixture and receipt prove local disposable Core/Interface/Electron behavior. They are not packaged, deployed, or production proof.
