import type { EnvironmentCredential } from "#environment-client/environment-credential.contract";

export function environmentCredentialRequest(
  credential: EnvironmentCredential,
): {
  readonly credentials: RequestCredentials;
  readonly headers: Record<string, string>;
} {
  return credential.type === "browser-session"
    ? { credentials: "same-origin", headers: {} }
    : {
        credentials: "omit",
        headers: { authorization: `Bearer ${credential.value}` },
      };
}
