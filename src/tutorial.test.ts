import { describe, expect, it } from "vitest";
import { placeCard } from "./tutorial";

const windowSize = { width: 1200, height: 800 };
const card = { width: 300, height: 150 };

describe("placeCard", () => {
  it("goes to the right of a part on the left edge", () => {
    const place = placeCard({ left: 0, top: 100, width: 380, height: 200 }, card, windowSize);
    expect(place).toEqual({ left: 396, top: 100 });
  });

  it("goes below a wide part along the top", () => {
    const place = placeCard({ left: 400, top: 0, width: 800, height: 40 }, card, windowSize);
    expect(place.top).toBe(56);
  });

  it("goes to the left of a tall part on the right edge", () => {
    const place = placeCard({ left: 950, top: 100, width: 250, height: 690 }, card, windowSize);
    expect(place).toEqual({ left: 634, top: 100 });
  });

  it("centers in the window when the part fills it", () => {
    const place = placeCard({ left: 380, top: 0, width: 820, height: 800 }, card, windowSize);
    expect(place).toEqual({ left: 640, top: 325 });
  });

  it("never leaves the window", () => {
    const place = placeCard({ left: 0, top: 790, width: 380, height: 10 }, card, windowSize);
    expect(place.top).toBeLessThanOrEqual(windowSize.height - card.height);
  });
});
