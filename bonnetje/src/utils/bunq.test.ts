import { expect, it } from "vitest";
import { bunqLink } from "./bunq";

it("builds a bunq.me link with amount and description", () => {
  expect(bunqLink("some.one", 12.5, "Bonnetje Splitter 2026-007")).toBe(
    "https://bunq.me/some.one/12.50/Bonnetje%20Splitter%202026-007",
  );
});
