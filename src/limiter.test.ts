import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("createLimiter", () => {
  it("never runs more tasks at once than allowed, and finishes them all", async () => {
    const limit = createLimiter(3);
    let running = 0;
    let busiest = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, number) =>
        limit(async () => {
          running++;
          busiest = Math.max(busiest, running);
          await pause(5);
          running--;
          return number;
        }),
      ),
    );
    expect(busiest).toBe(3);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("a failing task does not hold its place or stop the others", async () => {
    const limit = createLimiter(1);
    const failing = limit(async () => {
      throw new Error("boom");
    });
    const after = limit(async () => "still runs");
    await expect(failing).rejects.toThrow("boom");
    await expect(after).resolves.toBe("still runs");
    // and the place is free again afterwards
    await expect(limit(async () => "free")).resolves.toBe("free");
  });
});
