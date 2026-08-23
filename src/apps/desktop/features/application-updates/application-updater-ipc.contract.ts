export const applicationUpdaterIpc = {
  check: "rebase:updates:check",
  install: "rebase:updates:install",
  selectReleaseChannel: "rebase:updates:select-release-channel",
  setCheckAutomatically: "rebase:updates:set-check-automatically",
  snapshot: "rebase:updates:snapshot",
  snapshotChanged: "rebase:updates:snapshot-changed",
} as const;
