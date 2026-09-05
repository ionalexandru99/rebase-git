# Validate a change

Use the Node version in `.node-version`, the pnpm version in `package.json`, and
`pnpm install --frozen-lockfile`. CI also runs quality checks on Node 22.18.0.

## Before handing off code

1. Read the affected contracts, tests, and earlier fixes. Select the lowest test
   layer that proves the changed behavior.
2. Run focused tests while implementing, then the affected project on the final
   tree. Use the commands below. Revalidate affected checks after a rebase or edit.
3. Record the commit, commands, results, and any platform checks that could not run.
4. For a pushed PR, inspect required checks on the latest remote commit before
   calling it ready. Read failed-job logs and artifacts before rerunning. Keep the
   first failure visible when a same-commit rerun passes. Alex merges.

Documentation-only changes need document/link checks, not application builds.

## Local entry points

| Command | What it proves |
| --- | --- |
| `pnpm validate:quality` | Formatting, linting, workspace types, unit tests, and application builds. Run for every code change. |
| `pnpm validate:integration` | Desktop/web preparation and native Git, SQLite, filesystem, transport, and process integration. |
| `pnpm validate:browser` | Protocol compatibility, browser storage/lifecycle integration, and UI behavior. |
| `pnpm validate:desktop` | Electron preparation, existing browser/desktop journeys, and unpacked application launch. |
| `pnpm validate` | All four sets above on the current operating system. |
| `pnpm validate:release` | Builds every configured installer target for the current OS/architecture, then launches the unpacked application. Never publishes. |
| `pnpm test:performance` | Builds prerequisites and runs the existing performance suite. Corpus-dependent tests need the environment variables below. |

Server, Git, migration, filesystem, or process changes need native integration.
Browser cache, worker, history lifecycle, UI, and protocol changes need browser
validation. Desktop, preload, or startup changes need desktop validation.
Packaging, builder patches, dependency changes, and release scripts need a native
release rehearsal. History/graph performance changes need relevant benchmarks.

Install the matching browser once with `pnpm exec playwright install chromium`.
On a disposable Linux runner, `pnpm exec playwright install --with-deps chromium`
also installs system dependencies. Linux desktop commands need Xvfb:

```bash
CI=1 xvfb-run --auto-servernum pnpm validate
CSC_IDENTITY_AUTO_DISCOVERY=false xvfb-run --auto-servernum pnpm validate:release
```

On Windows, set `$env:CI = '1'` and `$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'` in
PowerShell before running the same package scripts without Xvfb. On macOS, use
`CI=1 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm validate:release`.
Keep signing/notarization credentials out of local and PR rehearsals.

Use an isolated worktree and temporary test state. `CI=1` prevents Playwright from
reusing an existing web server. Its fixed port must be free; do not stop a daily
development server to make a check pass.

Commands ending in `:prepared` require their build prerequisites on the current
source. `test:release-smoke:built` launches an already packaged app under `release/`.
It does not build or install an installer. Use the higher-level validation commands
when preparing a worktree from scratch. Required suites reject empty selections.

For a focused check, pass a test path to its project command, for example:

```bash
pnpm test:integration:browser tests/integration/apps/web/repository-history/repository-history-reader.browser.test.ts
pnpm test:performance:prepared tests/performance/merge-topology.performance.test.ts
```

### npm and workflow changes

Use an empty temporary directory for the npm tarball. `npm pack` invokes the
existing package build through `prepack`:

```bash
npm pack --pack-destination <empty-temporary-directory>
node tests/package/smoke-packed-package.ts <empty-temporary-directory>
```

The smoke check installs the tarball into temporary state and verifies the CLI and
served browser assets. PR Validation repeats installation on Linux, macOS, and
Windows. A local pass proves only that local environment.

Lint `.github/workflows/` with actionlint 1.7.12 after workflow edits. CI runs the
same version using `rhysd/actionlint:1.7.12`, which includes ShellCheck. With Docker
available, run from the repository root:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
```

## CI and release checks

Validation runs quality on both supported Node lines, native integration and npm
installation on three operating systems, browser tests, desktop journeys, workflow
lint, and release-target rehearsal. Browser and desktop jobs run independently once
quality passes. The required `Validation` job rejects any unsuccessful dependency.

The rehearsal uses the same `package:desktop` command and
`electron-builder.config.js` targets as Release. It builds macOS arm64/x64 DMG and
ZIP, Windows x64 NSIS, and Linux x64 AppImage and DEB. Each runner also launches the
unpacked application. Signing discovery is disabled and no release credentials are
provided. Installer construction and unpacked launch do not prove installation,
code-signing, or notarization. The macOS synthetic keychain check remains in native
integration; real signing and notarization remain in Release.

Release requires the latest main push Validation run for its exact SHA to complete
successfully before building its package. It waits for an existing pending run for
up to 45 minutes. Missing, failed, cancelled, or timed-out validation stops the
release. A PR-head success, a different SHA, or a manual validation on another branch
cannot satisfy the gate. Re-running the same main Validation run is supported.

## Find failure evidence

Download `test-results-<job>-<OS>-<architecture>-<attempt>` from the run's artifacts.
Quality artifact names also include the Node version. Reports survive failed tests
and remain available for seven days. The upload includes the hidden
`tests/.artifacts/` directory, not the rest of the workspace.

- Vitest projects write separate JUnit XML files and retain browser screenshots.
- Playwright writes HTML/JUnit reports and retains failure traces and screenshots.
- Performance writes JSON/HTML reports, attachments, and runner/corpus metadata.
- Rehearsal installer artifacts use `rehearsal-<platform>-<architecture>` and remain
  available for one day. These artifacts are not release-channel updates.

Open the downloaded HTML report with `pnpm exec playwright show-report <report-directory>`
or a trace with `pnpm exec playwright show-trace <trace.zip>`. An install/build failure
before the test runner starts may only have the job log. Start there if no report exists.

## Performance workflow

Performance runs daily and can be dispatched manually. It has its own failing status
and does not block PR Validation while hosted-runner timing thresholds are assessed.
No retries or relaxed assertions hide a benchmark failure.

The workflow checks out Git v2.50.0 at
`16bd9f20a403117f2e0d9bcda6c6e621d3763e77` into `.benchmark-corpus/` with deep history
and without fetching moving branch tips or tags. It supplies that corpus to both
process and search benchmarks, alongside the suite's existing synthetic histories.
The fixed corpus makes comparisons reproducible; it is not a claim of coverage for
every large repository. Record a new baseline when changing that revision.

To run the same benchmarks locally, prepare that Git checkout separately and set
`HISTORY_PROCESS_CORPUS_PATH` and `HISTORY_SEARCH_REPOSITORY_PATH` to it. The process
benchmark requires Linux `/proc`; without its corpus it reports a skip. Record
skips as unverified. Compare the test commit, corpus revision/count, Node version,
CPU, memory, and runner image before interpreting a timing change. The workflow
saves these details in `benchmark-environment.txt`.

Windows write collisions, reader/SQLite cleanup, and other application findings from
the audit are separate work. This validation change does not fix those failures.
