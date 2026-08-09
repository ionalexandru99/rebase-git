import { type SidecarParentPort, startLegacySidecar } from '../sidecar/runtime'

export { type SidecarParentPort, startLegacySidecar }

const parentPort = (process as NodeJS.Process & { parentPort?: SidecarParentPort }).parentPort
if (parentPort) {
  startLegacySidecar(parentPort)
}
