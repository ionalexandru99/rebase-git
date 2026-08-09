import { type SidecarParentPort, startLegacySidecar } from './runtime'

const parentPort = (process as NodeJS.Process & { parentPort?: SidecarParentPort }).parentPort
if (parentPort) {
  startLegacySidecar(parentPort)
}
