import type { TransportLimits } from "@rebase/contracts/environment-connection/environment-transport-limits.contract";
import type { EnvironmentDiscovery } from "@rebase/contracts/environment-connection/http/environment-discovery.contract";
import type { EnvironmentCapability } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import type {
  EnvironmentHello,
  EnvironmentHelloResult,
} from "@rebase/contracts/environment-connection/websocket/environment-live-connection.contract";

export function negotiateEnvironmentHello(
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  currentSequence: number,
): EnvironmentHelloResult {
  if (hello.protocol.major !== discovery.protocol.major) {
    return {
      _tag: "HelloRejected",
      failure: {
        _tag: "ProtocolMajorMismatch",
        clientMajor: hello.protocol.major,
        requiredUpdate:
          hello.protocol.major < discovery.protocol.major ? "client" : "server",
        serverMajor: discovery.protocol.major,
      },
    };
  }

  const negotiatedMinor = Math.min(
    hello.protocol.minor,
    discovery.protocol.minor,
  );
  const minimumCompatibleMinor = Math.max(
    hello.protocol.minimumSupportedMinor,
    discovery.protocol.minimumSupportedMinor,
  );
  if (negotiatedMinor < minimumCompatibleMinor) {
    return {
      _tag: "HelloRejected",
      failure: {
        _tag: "ProtocolMinorMismatch",
        clientMinor: hello.protocol.minor,
        clientMinimumSupportedMinor: hello.protocol.minimumSupportedMinor,
        serverMinor: discovery.protocol.minor,
        serverMinimumSupportedMinor: discovery.protocol.minimumSupportedMinor,
      },
    };
  }

  return {
    _tag: "HelloAccepted",
    capabilities: negotiateCapabilities(
      discovery.capabilities,
      hello.capabilities,
      negotiatedMinor,
    ),
    currentSequence,
    environmentId: discovery.environmentId,
    limits: negotiatedLimits(discovery.limits, hello.receiveLimits),
    protocol: {
      major: discovery.protocol.major,
      minor: negotiatedMinor,
    },
  };
}

function negotiateCapabilities(
  serverCapabilities: ReadonlyArray<EnvironmentCapability>,
  clientCapabilities: ReadonlyArray<EnvironmentCapability>,
  negotiatedMinor: number,
) {
  const clientByName = new Map(
    clientCapabilities.map((capability) => [capability.name, capability]),
  );

  return serverCapabilities.flatMap((serverCapability) => {
    const clientCapability = clientByName.get(serverCapability.name);
    if (
      clientCapability === undefined ||
      (serverCapability.name === "repository-history" &&
        serverCapability.version !== clientCapability.version) ||
      serverCapability.introducedInMinor > negotiatedMinor ||
      clientCapability.introducedInMinor > negotiatedMinor
    ) {
      return [];
    }

    return [
      {
        introducedInMinor: Math.max(
          serverCapability.introducedInMinor,
          clientCapability.introducedInMinor,
        ),
        name: serverCapability.name,
        version: Math.min(serverCapability.version, clientCapability.version),
      },
    ];
  });
}

function negotiatedLimits(
  serverLimits: TransportLimits,
  clientLimits: EnvironmentHello["receiveLimits"],
): TransportLimits {
  return {
    helloTimeoutMilliseconds: serverLimits.helloTimeoutMilliseconds,
    maxCapturedOutputBytes: Math.min(
      serverLimits.maxCapturedOutputBytes,
      clientLimits.maxCapturedOutputBytes,
    ),
    maxHttpRequestBytes: serverLimits.maxHttpRequestBytes,
    maxHttpResponseBytes: Math.min(
      serverLimits.maxHttpResponseBytes,
      clientLimits.maxHttpResponseBytes,
    ),
    maxQueuedEventBytes: serverLimits.maxQueuedEventBytes,
    maxQueuedEvents: serverLimits.maxQueuedEvents,
    maxWebSocketRequestBytes: serverLimits.maxWebSocketRequestBytes,
    maxWebSocketResponseBytes: Math.min(
      serverLimits.maxWebSocketResponseBytes,
      clientLimits.maxWebSocketResponseBytes,
    ),
  };
}
