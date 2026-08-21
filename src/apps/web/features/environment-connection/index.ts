export {
  connectCurrentEnvironment,
  connectEnvironment,
  EnvironmentHelloRejected,
  type EnvironmentProtocolConnection,
  EnvironmentResponseError,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
} from "#web/features/environment-connection/environment-protocol-client";
export { exchangeEnvironmentPairing } from "#web/features/environment-connection/http/environment-http-client";
