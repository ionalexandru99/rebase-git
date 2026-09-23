export type { EnvironmentCredential } from "@rebase/environment-client";
export {
  createEnvironmentJsonClient,
  exchangeEnvironmentPairing,
  exchangeEnvironmentPairingEffect,
} from "@rebase/environment-client";
export {
  connectCurrentEnvironment,
  connectCurrentEnvironmentEffect,
  connectEnvironment,
  connectEnvironmentEffect,
  EnvironmentAuthorizationRejected,
  EnvironmentHelloRejected,
  type EnvironmentProtocolConnection,
  EnvironmentResponseError,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
} from "#web/app/environment/connection/environment-protocol-client";
