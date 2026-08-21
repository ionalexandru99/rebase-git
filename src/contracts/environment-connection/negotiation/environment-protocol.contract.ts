import { Schema } from "effect";

const ProtocolNumber = Schema.Natural.check(Schema.isLessThanOrEqualTo(65_535));
const CapabilityName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
);
const ProductVersion = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
);

export const ProtocolRange = Schema.Struct({
  major: ProtocolNumber,
  minor: ProtocolNumber,
  minimumSupportedMinor: ProtocolNumber,
}).check(
  Schema.makeFilter(
    (range) =>
      range.minimumSupportedMinor <= range.minor ||
      "minimumSupportedMinor must not exceed minor",
  ),
);

export type ProtocolRange = typeof ProtocolRange.Type;

export const EnvironmentCapability = Schema.Struct({
  name: CapabilityName,
  version: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(65_535),
  ),
  introducedInMinor: ProtocolNumber,
});

export type EnvironmentCapability = typeof EnvironmentCapability.Type;

export const EnvironmentCapabilities = Schema.Array(
  EnvironmentCapability,
).check(
  Schema.isMaxLength(32),
  Schema.makeFilter((capabilities) => {
    const names = new Set(capabilities.map((capability) => capability.name));
    return (
      names.size === capabilities.length || "capability names must be unique"
    );
  }),
);

export const ProductVersionSchema = ProductVersion;

export const currentEnvironmentProtocol = {
  major: 1,
  minor: 2,
  minimumSupportedMinor: 0,
} satisfies ProtocolRange;

export const currentEnvironmentCapabilities = [
  {
    introducedInMinor: 0,
    name: "environment-events",
    version: 1,
  },
  {
    introducedInMinor: 1,
    name: "sequence-resnapshot",
    version: 1,
  },
] satisfies ReadonlyArray<EnvironmentCapability>;
