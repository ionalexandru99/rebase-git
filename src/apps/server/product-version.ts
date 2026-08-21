import serverPackage from "@rebase/server/package.json" with { type: "json" };

export const productVersion = serverPackage.version;
