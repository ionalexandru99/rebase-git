export default {
  appId: 'com.example.git-gui',
  productName: 'Git GUI',
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
    owner: 'your-github-username',
    repo: 'git-gui'
  }
}
