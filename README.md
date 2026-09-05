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

## Contributing

Issues and pull requests are welcome in
[GitHub Issues](https://github.com/ionalexandru99/rebase-git/issues). `AGENTS.md` documents the
conventions this repository follows.

Start code changes with `pnpm validate:quality`, then run the boundary checks for
the changed area as described in `AGENTS.md`.

## License

Apache-2.0. See [LICENSE](LICENSE).
