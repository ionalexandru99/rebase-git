const azureSignOptions = {
  publisherName: process.env.AZURE_TRUSTED_SIGNING_PUBLISHER_NAME,
  endpoint: process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
  certificateProfileName: process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME,
  codeSigningAccountName: process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
}

const isAzureSigningConfigured = Object.values(azureSignOptions).every(
  (value) => typeof value === 'string' && value.trim() !== ''
)

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
    target: ['nsis'],
    ...(isAzureSigningConfigured ? { azureSignOptions } : {})
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
