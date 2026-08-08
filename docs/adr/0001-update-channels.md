# 1. Stable and nightly update channels over GitHub releases

Date: 2026-08-08

Status: accepted

## Context

The release workflow publishes two tracks: tagged stable releases and nightly prereleases tagged
`v<base>-nightly.<YYYYMMDD>.<run>`. Issue #218 adds an in-app channel selector built on
`electron-updater`'s `autoUpdater.channel`, `allowPrerelease` and `allowDowngrade`. Issue #222 asked
whether the release pipeline actually publishes anything those properties can resolve.

This was verified with real packaged Linux builds (electron-builder 26.15.3), by reading the
electron-updater 6.3.0 source shipped in `node_modules`, and by inspecting the live GitHub releases.

### What electron-builder emits

The update-manifest filename is `${publish.channel || 'latest'}` plus an OS suffix (`-linux`,
`-mac`, none on Windows). The version string plays no part in the name; a prerelease suffix does not
produce a channel manifest by itself.

- Version `0.1.0-nightly.20260808.1`, repo config as-is: `latest-linux.yml`.
- Version `0.1.0`, repo config as-is: `latest-linux.yml`.
- Version `0.1.0-nightly.20260808.1` with `--config.publish.channel=nightly`: `nightly-linux.yml`
  and no `latest-linux.yml`.

The AppImage embeds its blockmap; NSIS and macOS zip targets emit separate `.blockmap` files. With
`publish.channel=nightly` the packaged app's embedded `app-update.yml` also gains `channel: nightly`,
which the GitHub provider ignores at runtime (it reads only `autoUpdater.channel` and the running
version), so it is harmless.

### How the GitHub provider resolves a channel (electron-updater 6.3.0, `GitHubProvider.getLatestVersion`)

With `allowPrerelease === false`:

- `autoUpdater.channel` is ignored entirely.
- The release is resolved through GitHub's `releases/latest`, which only ever points at a
  non-prerelease release marked latest. The provider then downloads `latest-<os>.yml` from that
  release's assets — the name is hardcoded via `getDefaultChannelName()`.

With `allowPrerelease === true`:

- `currentChannel = autoUpdater.channel || semver.prerelease(currentVersion)?.[0] || null`.
- If `currentChannel` is null, the newest entry of the releases atom feed wins, prerelease or not.
- Otherwise the feed is scanned newest-first for the first tag whose first prerelease component
  equals `currentChannel`. Stable tags never match a custom channel like `nightly`, so a nightly
  updater can never be handed a stable release on this path; the only road back to stable is
  flipping `allowPrerelease` off.
- The channel file requested is named after the selected tag's prerelease component
  (`v0.1.1-nightly.x` → `nightly-linux.yml`), not after `autoUpdater.channel`, with a fallback to
  `latest-<os>.yml` from the same tag if that fetch fails.

Property semantics that matter:

- `allowPrerelease` defaults to `true` whenever the running version contains a prerelease component,
  so a nightly build opts into prereleases unless the app explicitly sets it to `false`.
- Setting `autoUpdater.channel` force-sets `allowDowngrade = true`, and once set the channel cannot
  be reset to null in the same process (the setter rejects non-string values after first assignment).
- `isUpdateAvailable` uses plain semver: `semver.eq` → no update, `semver.gt(latest, current)` →
  update, otherwise `allowDowngrade && semver.lt(latest, current)`. Because nightlies are versioned
  one patch ahead of the stable base (`0.0.2-nightly.x` while stable is `0.0.1`), nightly → stable
  is a semver downgrade until the base catches up, and needs `allowDowngrade` on the stable side of
  the switch.

### What the pipeline actually publishes

Nothing an updater can use, on either channel:

- `.github/workflows/release.yml` packages with `--publish never` and neither the artifact upload
  nor the release step includes `*.yml` or `*.blockmap`. The live nightly
  `v0.0.1-nightly.20260808.13` carries only installers — every update check ends in
  `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`.
- Every release so far, including stable-track alphas, is flagged prerelease with
  `make_latest=false`, so `releases/latest` returns 404 and the stable path dies earlier still with
  `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`. GitHub cannot mark a prerelease as latest, so this cannot
  be fixed while stable alphas keep the prerelease flag.
- The two macOS arch jobs each produce a `latest-mac.yml` naming only their own zip, and the release
  job's `merge-multiple: true` download would keep an arbitrary one, stranding the other arch.

## Decision

Keep GitHub releases as the only publish backend — no generic provider, no second host. Two
channels are served from one release feed by making GitHub's own release metadata the discriminator:

1. GitHub's prerelease flag means nightly, and nothing else. Stable releases — including 0.x alphas
   and betas — publish with `prerelease=false` and `make_latest=true`, so `releases/latest` always
   points at the newest stable. Alpha/beta remain in the release name only.
2. Nightly builds pass `--config.publish.channel=nightly`, emitting `nightly.yml` /
   `nightly-mac.yml` / `nightly-linux.yml`; stable builds keep the default `latest*` manifests,
   which the `allowPrerelease=false` path requires by name.
3. The workflow uploads the manifests and blockmaps with the installers, merges the two macOS
   manifests' `files` lists into one `latest-mac.yml` (or `nightly-mac.yml`) in the release job, and
   attaches everything to the GitHub release.
4. `electron-builder.config.js` is unchanged; the channel is injected per-build in CI so local
   `pnpm package` keeps producing stable-shaped output.

App-side contract for #218:

- Nightly channel: `autoUpdater.channel = 'nightly'`, `allowPrerelease = true`,
  `allowDowngrade = true`.
- Stable channel: never touch `autoUpdater.channel` (it cannot be cleared in-session and the GitHub
  provider ignores it when `allowPrerelease` is false; `channel = 'stable'` would match no tags at
  all under `allowPrerelease`), set `allowPrerelease = false` explicitly to override the
  prerelease-version default, and set `allowDowngrade = semver.prerelease(currentVersion) != null`
  so a running nightly can walk back down.
- Channel guard: accept an offered version only when `semver.prerelease(version)?.[0]` is
  `'nightly'` on the nightly channel and `null` on stable; discard the result otherwise.

## Consequences

- Auto-update starts working at all; today no published release is updatable from.
- The next stable release changes what the prerelease badge means on the releases page: alphas and
  betas will no longer show it. The release name keeps carrying the maturity label.
- Nightlies published before this change have no manifests, so installs of them can never
  self-update; those users reinstall once from a post-change build.
- Differential updates (NSIS, macOS zip) become possible because blockmaps ship next to the
  installers.
- The merged `latest-mac.yml` keeps one arch's legacy top-level `path`/`sha512`; electron-updater
  6.x selects from `files` by arch, so this only affects long-obsolete updaters.
- The deb package still has no update path; the AppImage is the Linux auto-update carrier.
- An alternative to the manifest merge — building both macOS arches in a single electron-builder
  invocation on one runner, which emits a combined manifest natively — was set aside because it
  restructures the signing and verification matrix; it remains open as a later simplification.
