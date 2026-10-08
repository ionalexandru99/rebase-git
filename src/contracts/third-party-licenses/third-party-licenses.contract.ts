export interface ThirdPartyLicense {
  readonly name: string;
  readonly version: string | null;
  readonly license: string;
  readonly sourceUrl: string | null;
  readonly notice: string;
}

export const thirdPartyLicensesFile = "third-party-licenses.json";
