export default {
  appId: 'com.rebase-git.app',
  productName: 'Rebase',
  directories: {
    output: 'release'
  },
  files: ['out'],
  // TODO: code-signing/notarization (mac: hardenedRuntime: true + entitlements + notarize;
  // win: signing) is out of scope until a signed release feed exists.
  mac: {
    target: ['dmg', 'zip']
  },
  win: {
    target: ['nsis', 'zip']
  },
  linux: {
    target: ['AppImage', 'deb', 'rpm']
  },
  publish: {
    provider: 'github',
    owner: 'ionalexandru99',
    repo: 'rebase-git'
  }
}
