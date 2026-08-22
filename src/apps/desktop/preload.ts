import { contextBridge } from "electron";
import type { DesktopHostBridge } from "#desktop/desktop-host.contract";

const host = Object.freeze({
  environmentOrigin: readRequiredArgument("--rebase-environment-origin="),
  pairingMaterial: readRequiredArgument("--rebase-pairing-material="),
}) satisfies DesktopHostBridge;
contextBridge.exposeInMainWorld("rebaseHost", host);

function readRequiredArgument(prefix: string) {
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);

  if (value === undefined) {
    throw new Error(
      `The Electron host did not provide ${prefix.slice(2, -1)}.`,
    );
  }

  return value;
}
