import type { ManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor.contract";

export type DesktopRenderer =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "url"; readonly url: string };

export interface DesktopWindowOptions {
  readonly environmentOrigin: string;
  readonly renderer: DesktopRenderer;
}

export interface DesktopApplicationHost {
  readonly platform: NodeJS.Platform;
  hasOpenWindows(): boolean;
  openWindow(options: DesktopWindowOptions): Promise<void> | void;
  quit(): void;
}

export interface DesktopQuitEvent {
  preventDefault(): void;
}

export interface DesktopApplicationOptions {
  readonly host: DesktopApplicationHost;
  readonly renderer: DesktopRenderer;
  readonly startEnvironment: () => Promise<ManagedEnvironmentServer>;
}
