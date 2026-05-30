import test from "node:test";
import assert from "node:assert/strict";
import { formatRelativePlayedAt } from "../src/lib/relative-time.ts";

test("formatRelativePlayedAt advances when the current time advances", () => {
  const playedAtMs = Date.UTC(2026, 4, 30, 10, 0, 0);

  assert.equal(
    formatRelativePlayedAt(playedAtMs, Date.UTC(2026, 4, 30, 10, 59, 0), "en"),
    "59m ago",
  );
  assert.equal(formatRelativePlayedAt(playedAtMs, Date.UTC(2026, 4, 30, 11, 0, 0), "en"), "1h ago");
});
