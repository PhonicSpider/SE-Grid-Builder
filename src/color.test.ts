import { describe, expect, it } from "vitest";
import { hexToPaint, paintToHex } from "./color";

describe("color", () => {
  it("round-trips hex through hue / saturation / value", () => {
    for (const hex of ["#ffffff", "#000000", "#c0392b", "#27ae60", "#2980b9", "#8c8c8c"]) {
      expect(paintToHex(hexToPaint(hex))).toBe(hex);
    }
  });

  it("reads pure red as hue 0, full saturation and value", () => {
    expect(hexToPaint("#ff0000")).toEqual({ hue: 0, saturation: 1, value: 1 });
  });
});
