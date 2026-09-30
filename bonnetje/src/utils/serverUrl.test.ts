import { describe, expect, it } from "vitest";
import { isLocalHost, normalizeServerUrl } from "./serverUrl";

describe("normalizeServerUrl", () => {
  it("keeps http for local addresses", () => {
    expect(normalizeServerUrl("192.168.1.50:3000")).toBe("http://192.168.1.50:3000");
    expect(normalizeServerUrl("http://10.0.0.5:3000/")).toBe("http://10.0.0.5:3000");
    expect(normalizeServerUrl("bonnetje.local:3000")).toBe("http://bonnetje.local:3000");
    expect(normalizeServerUrl("100.101.102.103:3000")).toBe("http://100.101.102.103:3000");
    expect(normalizeServerUrl("localhost:3000")).toBe("http://localhost:3000");
  });
  it("uses https for everything else, even when http was typed", () => {
    expect(normalizeServerUrl("bonnetje.example.com")).toBe("https://bonnetje.example.com");
    expect(normalizeServerUrl("http://bonnetje.example.com/")).toBe("https://bonnetje.example.com");
    expect(normalizeServerUrl("8.8.8.8:3000")).toBe("https://8.8.8.8:3000");
    expect(normalizeServerUrl("http://8.8.8.8:3000")).toBe("https://8.8.8.8:3000");
    expect(normalizeServerUrl("http://192.168.1.50.evil.com")).toBe("https://192.168.1.50.evil.com");
  });
  it("respects an explicit https, also for local addresses", () => {
    expect(normalizeServerUrl("https://192.168.1.50:3000")).toBe("https://192.168.1.50:3000");
  });
});

describe("isLocalHost", () => {
  it("knows the private ranges", () => {
    expect(isLocalHost("172.16.0.1")).toBe(true);
    expect(isLocalHost("172.32.0.1")).toBe(false);
    expect(isLocalHost("100.63.0.1")).toBe(false);
    expect(isLocalHost("192.169.0.1")).toBe(false);
  });
});
