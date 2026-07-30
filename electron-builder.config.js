export default {
  appId: 'com.rebase-git.app',
  productName: 'Rebase',
  directories: {
    output: 'release'
  },
  files: ['out'],
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
