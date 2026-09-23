export {
  type DesktopApplication,
  startDesktopApplication,
} from "#desktop/app/desktop-application";
export type {
  DesktopApplicationHost,
  DesktopApplicationOptions,
  DesktopQuitEvent,
  DesktopRenderer,
  DesktopWindowOptions,
} from "#desktop/app/desktop-application.contract";
export { createApplicationUpdateSettingsStore } from "#desktop/features/application-updates/application-update-settings-store";
export { createApplicationUpdater } from "#desktop/features/application-updates/application-updater";
export type {
  ApplicationUpdater,
  DesktopAutoUpdater,
} from "#desktop/features/application-updates/application-updater.contract";
export { createRepositoryFilesystem } from "#desktop/features/repository-filesystem/repository-filesystem";
export type {
  RepositoryFilesystem,
  RepositoryFilesystemPlatform,
} from "#desktop/features/repository-filesystem/repository-filesystem.contract";
export { startManagedEnvironmentServer } from "#desktop/platform/environment/environment-supervisor";
export type { ManagedEnvironmentServer } from "#desktop/platform/environment/environment-supervisor.contract";
