export function ageLabel(seconds: number, now = Date.now()) {
  const elapsed = Math.max(0, now / 1_000 - seconds);
  if (elapsed < 60) return "now";
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)} min ago`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)} h ago`;
  const date = new Date(seconds * 1_000);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
