# Plan: let Electron's postinstall fetch the binary, retire the runtime helper

**Status:** Not started — scheduled for a future PR (after the `phase-0-guardrails` PR #33 lands).
**Owner:** TBD
**Created:** 2026-06-17

## Goal

Stop blocking install scripts globally and let Electron's own `postinstall`
(`install.js`, via `@electron/get`) download the binary during `pnpm install`.
This removes the need for `scripts/ensure-electron-runtime.mjs` and its CI step
entirely.

## Why

- Today `.npmrc` has `ignore-scripts=true`, which blocks **every** dependency's
  install scripts — including Electron's binary download. That's the only reason
  `ensure-electron-runtime.mjs` exists (it manually re-runs `install.js`).
- pnpm 10+ supports `pnpm.onlyBuiltDependencies` — an allowlist of packages
  permitted to run build/install scripts. This is the modern, scoped replacement
  for a blanket `ignore-scripts`: Electron's binary downloads with built-in
  checksum verification, and nothing else runs arbitrary scripts.
- t3code does the equivalent with Bun's `trustedDependencies: ["electron"]` —
  one `install`, no helper script, no `.npmrc` dance. This plan brings the same
  ergonomics to our pnpm setup.
- `AGENTS.md` already references `pnpm.onlyBuiltDependencies` as the intended
  mechanism for "restricted postinstall scripts", so this aligns the config with
  the documented rule.

## Current state (as of PR #33)

- `.npmrc`: `engine-strict=true`, `ignore-scripts=true`.
- `package.json`: `trustedDependencies: ["node-pty", "electron"]` (this field is
  a Bun/npm convention; **pnpm ignores it** — it reads `pnpm.onlyBuiltDependencies`).
  No `pnpm.onlyBuiltDependencies` section exists yet.
- `scripts/ensure-electron-runtime.mjs`: already trimmed to just run `install.js`
  and throw if the binary is missing (the manual zip download/extract fallback
  was removed — see memory `project_no_electron_zip_fallback.md`).
- `.github/workflows/ci.yml`: the "Build & integration" job runs
  `node scripts/ensure-electron-runtime.mjs` before build/tests.

## Proposed change

1. **`package.json`** — add (pnpm reads this; keep it minimal and allowlist-only):
   ```jsonc
   "pnpm": {
     "onlyBuiltDependencies": ["electron"]
   }
   ```
   Decide whether `node-pty` (currently in `trustedDependencies`) also needs to
   build — if it's an actual runtime dep with a native postinstall, add it too.
   Audit other deps that legitimately need build scripts (e.g. esbuild) before
   removing the global block, so nothing silently stops building.
2. **`.npmrc`** — remove `ignore-scripts=true`. Keep `engine-strict=true`.
3. **Delete** `scripts/ensure-electron-runtime.mjs`.
4. **`.github/workflows/ci.yml`** — remove the "Ensure Electron runtime" step.
   The plain `pnpm install --frozen-lockfile` now fetches the binary.
5. **Regenerate `pnpm-lock.yaml`** if needed and verify the lockfile diff is
   sane (pnpm records `onlyBuiltDependencies` decisions).

## Risks / things to watch

- **Removing the global `ignore-scripts` widens the attack surface.** Mitigate by
  keeping the allowlist tight (`onlyBuiltDependencies`) so only vetted packages
  run scripts. Confirm no unexpected package starts running a postinstall.
- A package that previously needed a build script but was silently broken by
  `ignore-scripts` might change behavior. Audit `pnpm install` output for
  "ignored build scripts" warnings before/after.
- `electron-builder` may have its own postinstall expectations — verify
  `pnpm build:*` / packaging still works.
- CI cache key is unaffected (still `pnpm-lock.yaml` hash), but the first run
  after the change re-downloads Electron; ensure timeouts are adequate.

## Verification

- Fresh clone simulation: `rm -rf node_modules && pnpm install --frozen-lockfile`,
  then confirm `node_modules/.../electron/dist/electron` exists and is executable.
- `pnpm build` succeeds.
- `xvfb-run -a pnpm test:e2e` and `xvfb-run -a pnpm test:smoke` pass in CI
  (the `--no-sandbox` smoke fix from PR #33 stays).
- `pnpm typecheck`, `pnpm lint`, `pnpm check` clean.
- Inspect `pnpm install` output: only `electron` (and any deliberately allowed
  package) reports running build scripts.

## Rollback

Re-add `ignore-scripts=true` to `.npmrc` and restore
`scripts/ensure-electron-runtime.mjs` + the CI step from git history
(commit on `phase-0-guardrails`).

## Acceptance criteria

- [ ] `ignore-scripts=true` removed from `.npmrc`.
- [ ] `pnpm.onlyBuiltDependencies` allowlists exactly the packages that need it.
- [ ] `ensure-electron-runtime.mjs` and its CI step deleted.
- [ ] Clean-install + build + e2e + smoke all green in CI.
- [ ] No unexpected packages running install scripts.
