export interface ThirdPartyLicense {
  readonly name: string;
  readonly version: string | null;
  readonly license: string;
  readonly sourceUrl: string | null;
  readonly notice: string;
}

export const thirdPartyLicensesFile = "third-party-licenses.json";

export async function loadThirdPartyLicenses(
  signal: AbortSignal,
): Promise<readonly ThirdPartyLicense[]> {
  const response = await fetch(`./${thirdPartyLicensesFile}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as readonly ThirdPartyLicense[];
}

export function filterThirdPartyLicenses(
  licenses: readonly ThirdPartyLicense[],
  query: string,
): readonly ThirdPartyLicense[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return licenses;
  return licenses.filter((entry) => {
    const text = [entry.name, entry.version, entry.license]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
