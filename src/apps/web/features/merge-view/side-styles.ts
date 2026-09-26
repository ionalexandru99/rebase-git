import type { ConflictSide } from "@rebase/contracts";

export type LineOrigin = ConflictSide | "edited";

export const sideNames: Record<ConflictSide, string> = {
  base: "Base",
  current: "Current",
  incoming: "Incoming",
};

export const sideRows: Record<ConflictSide, string> = {
  base: "bg-muted",
  current: "bg-[#69b1ff]/10",
  incoming: "bg-[#5ecc71]/10",
};

export const sideMarks: Record<ConflictSide, string> = {
  base: "bg-foreground/15",
  current: "bg-[#69b1ff]/35",
  incoming: "bg-[#5ecc71]/35",
};

export const originEdges: Record<LineOrigin, string> = {
  base: "bg-muted-foreground",
  current: "bg-[#69b1ff]",
  incoming: "bg-[#5ecc71]",
  edited: "bg-foreground/60",
};

export const checkedBoxes: Record<ConflictSide, string> = {
  base: "border-muted-foreground bg-muted-foreground text-background",
  current: "border-[#69b1ff] bg-[#69b1ff] text-background",
  incoming: "border-[#5ecc71] bg-[#5ecc71] text-background",
};
