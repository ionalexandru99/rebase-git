# Dependency patches

`app-builder-lib@26.15.3.patch` backports [electron-builder #10101](https://github.com/electron-userland/electron-builder/pull/10101). macOS keychain setup must authenticate with the generated keychain password, while certificate import uses the certificate's password.

Remove the patch when upgrading to a release that includes this fix. Keep the macOS keychain integration check in validation.
