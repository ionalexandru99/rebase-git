import {
  type DesktopHostBridge,
  DesktopUpdateSnapshotSchema,
  type DesktopUpdates,
} from "@rebase/contracts";
import { Schema } from "effect";

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}

const decodeSnapshot = Schema.decodeUnknownSync(DesktopUpdateSnapshotSchema);

export function readDesktopHostBridge(): DesktopHostBridge | undefined {
  const host = window.rebaseHost;
  if (host === undefined) return undefined;
  return { ...host, updates: decodedDesktopUpdates(host.updates) };
}

function decodedDesktopUpdates(updates: DesktopUpdates): DesktopUpdates {
  return {
    ...updates,
    getSnapshot: () => updates.getSnapshot().then(decodeSnapshot),
    subscribe: (listener) =>
      updates.subscribe((snapshot) => listener(decodeSnapshot(snapshot))),
  };
}
