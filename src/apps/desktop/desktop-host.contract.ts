export interface DesktopHostBridge {
  readonly environmentOrigin: string;
}

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}
