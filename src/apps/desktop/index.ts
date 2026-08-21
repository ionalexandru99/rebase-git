export {
  type DesktopApplication,
  startDesktopApplication,
} from "#desktop/features/desktop-application/desktop-application";
export type {
  DesktopApplicationHost,
  DesktopQuitEvent,
  DesktopRenderer,
  DesktopWindowOptions,
} from "#desktop/features/desktop-application/desktop-application.contract";
export { startManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor";
export type { ManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor.contract";
