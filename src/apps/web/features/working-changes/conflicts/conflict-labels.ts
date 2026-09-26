import type {
  ConflictFile,
  ConflictSide,
  ConflictSides,
  SideLabel,
} from "@rebase/contracts";

const sideNames: Record<ConflictSide, string> = {
  current: "Current",
  incoming: "Incoming",
  base: "Base",
};

export function versionLabel(side: ConflictSide, label: SideLabel) {
  const identity = label.commit?.slice(0, 8) ?? label.ref;
  return identity ? `${sideNames[side]} ${identity}` : sideNames[side];
}

export function conflictLabel(
  file: ConflictFile,
  sides: ConflictSides | undefined,
) {
  if (file.openRegions > 0) return `${file.openRegions} open`;
  if (file.stages.some((stage) => stage.binary)) return "binary";
  switch (file.kind) {
    case "both-modified":
      return "both changed";
    case "both-added":
      return "both added";
    case "both-deleted":
      return "both deleted";
    case "deleted-in-current":
      return `deleted in ${sideName("current", sides)}`;
    case "deleted-in-incoming":
      return `deleted in ${sideName("incoming", sides)}`;
    case "added-in-current":
      return `added in ${sideName("current", sides)}`;
    case "added-in-incoming":
      return `added in ${sideName("incoming", sides)}`;
  }
}

function sideName(side: ConflictSide, sides: ConflictSides | undefined) {
  const label = sides?.[side];
  return label?.ref ?? label?.commit?.slice(0, 8) ?? side;
}
