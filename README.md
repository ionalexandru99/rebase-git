<div align="center">
  <img src="https://raw.githubusercontent.com/ionalexandru99/rebase-git/main/src/apps/desktop/assets/icon.png" alt="" width="128" height="128">
  <h1>Rebase</h1>
  <p><strong>A fast local Git client for macOS, Windows, and Linux.</strong></p>
</div>

Rebase is a desktop and browser app for working with Git repositories. Browse commit history,
switch branches, and move between projects in a fast interface built for large codebases.

The project is under active development and is not ready for day-to-day use yet.

## Install the desktop app

Install Git 2.34 or newer, then download Rebase from the
[latest release](https://github.com/ionalexandru99/rebase-git/releases/latest).

| System | Download | Install |
| --- | --- | --- |
| macOS | `.dmg`, `arm64` for Apple silicon or `x64` for Intel | Open the disk image and drag Rebase into Applications. |
| Windows | `.exe` | Run the installer. |
| Linux | `.AppImage` | Allow the file to run as a program in its properties, then open it. |
| Debian / Ubuntu | `.deb` | Open the package with your software installer. |

## Run in your browser

Install Node.js 24 and Git 2.34 or newer, then run:

```bash
npx rebase-git@latest
```

Rebase runs locally and opens in your default browser. On WSL, run the command in your Linux terminal.

To install the command instead:

```bash
npm install --global rebase-git
rebase serve
```

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

## License

Apache-2.0. See [LICENSE](LICENSE).
