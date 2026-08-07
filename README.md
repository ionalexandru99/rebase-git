<div align="center">
  <img src="build/icon.png" alt="" width="128" height="128">
  <h1>Rebase</h1>
  <p><strong>A fast desktop Git client for macOS, Windows, and Linux.</strong></p>
</div>

Rebase is a Git GUI for people who commit dozens of times a day. Open several repositories at once
in tabs, stage whole files, individual hunks, or single lines from a syntax-highlighted diff, and
commit, push, pull, branch, tag, merge, rebase, or stash from one window.

Git runs in a separate background process, so the window stays responsive even in a repository with
hundreds of thousands of commits.

## Install

Rebase runs the `git` binary already on your machine, so Git must be installed and on your PATH.

Download the build for your platform from the
[releases page](https://github.com/ionalexandru99/rebase-git/releases).

### macOS

1. Download `Rebase-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for Intel.
2. Open the `.dmg` and drag **Rebase** into your Applications folder.
3. Launch it from Applications.

### Windows

Download `Rebase-<version>-win-x64.exe` and run it. It installs into your user profile and adds
Start Menu and desktop shortcuts, so it does not need administrator rights.

### Linux

**AppImage** — works on any distribution, nothing to install:

```bash
chmod +x Rebase-<version>-linux-x86_64.AppImage
./Rebase-<version>-linux-x86_64.AppImage
```

If it exits complaining about FUSE, either install `libfuse2` or run it with
`--appimage-extract-and-run`.

**Debian / Ubuntu** — use the `.deb` so Rebase appears in your application launcher:

```bash
sudo apt install ./Rebase-<version>-linux-amd64.deb
```

## Run it locally

You need [Node.js](https://nodejs.org) 24.15 or newer within major 24, pnpm 11.2.2, and Git.

```bash
npm install --global pnpm@11.2.2

git clone https://github.com/ionalexandru99/rebase-git.git
cd rebase-git
pnpm install
pnpm dev
```

On Linux, Electron also needs a few system libraries. Package names vary by distribution; these are
the Ubuntu/Debian ones:

```bash
sudo apt install -y libgtk-3-0 libnss3 libxss1 libasound2t64 libatk-bridge2.0-0 libdrm2 libgbm1
```

On older Ubuntu/Debian releases the audio package is named `libasound2` instead of `libasound2t64`.
macOS and Windows need nothing beyond Node, pnpm, and Git.

If `pnpm dev` fails with `Error: Electron uninstall` or `Electron failed to install correctly`,
Electron's platform binary was not unpacked — run `pnpm rebuild electron` and try again.

Every other script lives in `package.json`.

## Contributing

Issues and pull requests are welcome in
[GitHub Issues](https://github.com/ionalexandru99/rebase-git/issues); `AGENTS.md` documents the
conventions this repo follows.

## License

Apache-2.0 — see [LICENSE](LICENSE).
