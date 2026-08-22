<div align="center">
  <img src="https://raw.githubusercontent.com/ionalexandru99/rebase-git/main/src/apps/desktop/assets/icon.png" alt="" width="128" height="128">
  <h1>Rebase</h1>
  <p><strong>A fast local Git client for macOS, Windows, and Linux.</strong></p>
</div>

Rebase is a Git GUI for people who commit dozens of times a day. It runs against the Git binary on
your machine and keeps repository work in a separate local server, so the browser or desktop window
stays responsive in large repositories.

The project is under active development and is not ready for day-to-day use yet.

## Run with npx

Install Node.js 24 and Git 2.34 or newer, then run:

```bash
npx rebase-git@latest
```

Rebase listens on `127.0.0.1`, prints the local and pairing URLs, and tries to open the UI in your
default browser. It does not expose a remote-listening option.

To install the command instead:

```bash
npm install --global rebase-git
rebase serve
```

Use `rebase --version` to print the product and Environment protocol versions. Pass
`rebase serve --port <port>` to select a loopback port.

## Run from source

You need Node.js 24, pnpm 11.22.0, and Git 2.34 or newer.

```bash
git clone https://github.com/ionalexandru99/rebase-git.git
cd rebase-git
corepack enable pnpm
pnpm install
pnpm build:web
pnpm dev:server
```

For the desktop host, run:

```bash
pnpm dev:electron
```

Every other command lives in `package.json`.

## Release the local package

The next local package version is `0.0.2`. The `Release local package` GitHub Actions workflow reads
the `MAJOR.MINOR.PATCH` version committed in `package.json`. A nightly publishes
`0.0.2-nightly.YYYYMMDD.RUN` under npm's `nightly` tag and creates a matching GitHub prerelease. A
stable release publishes `0.0.2` under npm's `latest` tag and creates `v0.0.2` as the latest GitHub
release. Publishing only runs from `main`. Published versions and tags are immutable.

Add one Actions repository secret before the first release:

- `NPM_TOKEN`: a granular npm access token with read/write access to all packages and bypass 2FA
  enabled. All-packages access is needed for the first publish because `rebase-git` does not exist in
  npm yet. Use the shortest practical expiration and replace this token with npm trusted publishing
  after the package exists.

The workflow uses GitHub's OIDC identity to attach npm provenance. `GITHUB_TOKEN` creates the tag and
release, so it does not need another repository secret.

Select the `nightly` or `stable` channel and run the workflow with `publish` disabled first. This
builds, packs, and smoke-tests the resolved version on Linux, macOS, and Windows without changing npm
or GitHub. Run the same channel again with `publish` enabled from `main` after the dry run passes.
Bump `package.json` in a reviewed commit before starting the next release line.

The npm publish job finishes before the GitHub release job. If a later job fails, use GitHub's
`Re-run failed jobs` action on the same workflow run. A retry only accepts an existing npm version
when its integrity matches the artifact saved by that run. If npm does not contain the version, rerun
the workflow. Never change or delete an existing npm version or Git tag to recover a release.

## Contributing

Issues and pull requests are welcome in
[GitHub Issues](https://github.com/ionalexandru99/rebase-git/issues). `AGENTS.md` documents the
conventions this repository follows.

## License

Apache-2.0. See [LICENSE](LICENSE).
