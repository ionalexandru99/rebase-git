import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const credentialPrefix = "rebase.v1";

export function createDeviceCredential(
  serverSecret: string,
  authorizationId: string,
) {
  const secret = createSecretMaterial();
  const unsigned = `${credentialPrefix}.${authorizationId}.${secret}`;
  const signature = signCredential(serverSecret, unsigned);
  return `${unsigned}.${signature}`;
}

export function verifyDeviceCredential(
  serverSecret: string,
  credential: string | undefined,
) {
  if (credential === undefined) {
    return undefined;
  }
  const [product, version, authorizationId, secret, signature, excess] =
    credential.split(".");
  if (
    product !== "rebase" ||
    version !== "v1" ||
    authorizationId === undefined ||
    !/^[0-9a-f-]{36}$/.test(authorizationId) ||
    secret === undefined ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
    signature === undefined ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature) ||
    excess !== undefined
  ) {
    return undefined;
  }

  const unsigned = `${credentialPrefix}.${authorizationId}.${secret}`;
  const expected = Buffer.from(signCredential(serverSecret, unsigned));
  const received = Buffer.from(signature);
  return expected.byteLength === received.byteLength &&
    timingSafeEqual(expected, received)
    ? authorizationId
    : undefined;
}

export function createSecretMaterial() {
  return randomBytes(32).toString("base64url");
}

export function createPairingCode() {
  const digits = randomInt(1_000_000).toString().padStart(6, "0");
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function digestSecretMaterial(material: string) {
  return createHash("sha256").update(material).digest("base64url");
}

function signCredential(serverSecret: string, unsigned: string) {
  return createHmac("sha256", serverSecret)
    .update(unsigned)
    .digest("base64url");
}
