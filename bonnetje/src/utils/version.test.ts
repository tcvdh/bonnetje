import { describe, expect, it } from "vitest";
import { updateLevel } from "./version";

describe("updateLevel", () => {
  it("requires an update for a new minor or major version", () => {
    expect(updateLevel("1.1.2", "1.2.0")).toBe("required");
    expect(updateLevel("1.9.9", "2.0.0")).toBe("required");
  });
  it("only suggests a new patch", () => expect(updateLevel("1.1.2", "1.1.3")).toBe("optional"));
  it("is quiet when up to date or ahead", () => {
    expect(updateLevel("1.1.2", "1.1.2")).toBe("none");
    expect(updateLevel("1.2.0", "1.1.9")).toBe("none");
    expect(updateLevel("2.0.0", "1.9.0")).toBe("none");
  });
  it("ignores anything that is not a version", () => {
    expect(updateLevel("1.1.2", "<!doctype html>")).toBe("none");
    expect(updateLevel("1.1.2", " 1.1.3\n")).toBe("optional");
  });
});
