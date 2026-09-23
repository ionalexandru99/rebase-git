export interface DiffPreferences {
  readonly split: boolean;
  readonly wrap: boolean;
  readonly tree: boolean;
}
export const defaultDiffPreferences: DiffPreferences = {
  split: false,
  wrap: false,
  tree: true,
};
