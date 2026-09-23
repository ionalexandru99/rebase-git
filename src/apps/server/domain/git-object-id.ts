export type GitObjectFormat = "sha1" | "sha256";

const objectIdLengths: Readonly<Record<GitObjectFormat, number>> = {
  sha1: 40,
  sha256: 64,
};
const hexadecimal = /^[0-9a-f]+$/;

export function isGitObjectId(value: string, objectFormat?: GitObjectFormat) {
  const lengths =
    objectFormat === undefined
      ? Object.values(objectIdLengths)
      : [objectIdLengths[objectFormat]];
  return lengths.includes(value.length) && hexadecimal.test(value);
}
