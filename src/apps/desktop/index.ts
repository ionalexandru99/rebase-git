export { createApplicationUpdateSettingsStore } from "#desktop/features/application-updates/application-update-settings-store";
export { createApplicationUpdater } from "#desktop/features/application-updates/application-updater";
export type {
  ApplicationUpdater,
  DesktopAutoUpdater,
} from "#desktop/features/application-updates/application-updater.contract";
export {
  type DesktopApplication,
  startDesktopApplication,
} from "#desktop/features/desktop-application/desktop-application";
export type {
  DesktopApplicationHost,
  DesktopApplicationOptions,
  DesktopQuitEvent,
  DesktopRenderer,
  DesktopWindowOptions,
} from "#desktop/features/desktop-application/desktop-application.contract";
export { startManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor";
export type { ManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor.contract";
