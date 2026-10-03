export function compactCount(count: number) {
  if (count < 1_000) return String(count);
  const thousands = count / 1_000;
  return `${thousands < 10 ? Math.floor(thousands * 10) / 10 : Math.floor(thousands)}k`;
}
