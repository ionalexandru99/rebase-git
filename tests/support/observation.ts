import { expect } from "vite-plus/test";

export async function waitForObservation(
  observe: () => unknown,
  trigger?: () => unknown,
): Promise<void> {
  await expect
    .poll(async () => {
      try {
        await observe();
        return true;
      } catch (failure) {
        await trigger?.();
        throw failure;
      }
    })
    .toBe(true);
}
