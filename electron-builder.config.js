export default {
  appId: 'com.rebase-git.app',
  productName: 'Rebase',
  directories: {
    output: 'release'
  },
  files: ['out'],
  artifactName: `\${productName}-\${version}-\${os}-\${arch}.\${ext}`,
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip']
  },
  win: {
    target: ['nsis']
  },
  linux: {
    category: 'Development',
    target: ['AppImage', 'deb']
  },
  publish: {
    provider: 'github',
    owner: 'ionalexandru99',
    repo: 'rebase-git'
  }
}
