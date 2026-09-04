let sequence = 0;

export function createRepositoryHistoryRequestId() {
  const random = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    for (let index = 0; index < random.length; index += 1) {
      random[index] = Math.floor(Math.random() * 256);
    }
  } else {
    globalThis.crypto.getRandomValues(random);
  }
  sequence = (sequence + 1) >>> 0;
  random[6] = ((random[6] ?? 0) & 0x0f) | 0x40;
  random[8] = ((random[8] ?? 0) & 0x3f) | 0x80;
  random[12] = (random[12] ?? 0) ^ (sequence >>> 24);
  random[13] = (random[13] ?? 0) ^ (sequence >>> 16);
  random[14] = (random[14] ?? 0) ^ (sequence >>> 8);
  random[15] = (random[15] ?? 0) ^ sequence;
  const hex = Array.from(random, (value) =>
    value.toString(16).padStart(2, "0"),
  );

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
