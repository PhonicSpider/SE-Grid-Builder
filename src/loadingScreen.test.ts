import { describe, expect, it } from "vitest";
import { countText, stageFraction } from "./loadingScreen";

describe("countText", () => {
  it("writes the counter with thousands separators", () => {
    expect(countText("Found", 812, 1240, "blocks")).toBe("Found 812 / 1,240 blocks...");
  });
});

describe("stageFraction", () => {
  it("moves through its own slice of the bar", () => {
    expect(stageFraction(0.2, 0.6, 0, 10)).toBeCloseTo(0.2);
    expect(stageFraction(0.2, 0.6, 5, 10)).toBeCloseTo(0.4);
    expect(stageFraction(0.2, 0.6, 10, 10)).toBeCloseTo(0.6);
  });

  it("treats an empty stage as finished and never overshoots", () => {
    expect(stageFraction(0.2, 0.6, 0, 0)).toBeCloseTo(0.6);
    expect(stageFraction(0.2, 0.6, 99, 10)).toBeCloseTo(0.6);
  });
});
