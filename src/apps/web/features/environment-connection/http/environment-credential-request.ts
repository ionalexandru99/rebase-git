import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";

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
