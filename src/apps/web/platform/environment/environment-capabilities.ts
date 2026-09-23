import type { EnvironmentCapabilityName } from "@rebase/contracts";
import type { NegotiatedEnvironment } from "#web/platform/environment/environment-protocol.contract";

export function hasEnvironmentCapability(
  negotiated: Pick<NegotiatedEnvironment, "capabilities">,
  name: EnvironmentCapabilityName,
  minimumVersion = 1,
) {
  return negotiated.capabilities.some(
    (capability) =>
      capability.name === name && capability.version >= minimumVersion,
  );
}
