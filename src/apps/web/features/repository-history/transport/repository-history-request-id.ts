export function createRepositoryHistoryRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const random = crypto.getRandomValues(new Uint8Array(16));
  random[6] = ((random[6] ?? 0) & 0x0f) | 0x40;
  random[8] = ((random[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(random, (value) =>
    value.toString(16).padStart(2, "0"),
  );

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
