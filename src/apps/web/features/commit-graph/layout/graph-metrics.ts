export const graphRowHeight = 26;
export const graphHeaderHeight = 28;
export const graphLanePitch = 16;
export const graphLaneInset = 16;
const metadataColumnWidths = [149, 78, 112] as const;
export const graphMetadataColumns = metadataColumnWidths
  .map((width) => `${width}px`)
  .join(" ");
export const graphMetadataWidth = metadataColumnWidths.reduce<number>(
  (total, width) => total + width,
  0,
);
