export function listKeyIndex(key: string, index: number, length: number) {
  if (key === "ArrowDown") return Math.min(length - 1, index + 1);
  if (key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return undefined;
}
