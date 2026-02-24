import assert from "node:assert/strict";
import test from "node:test";
import { newsQuerySchema } from "./news.js";

test("news query rejects page=0", () => {
  const parsed = newsQuerySchema.safeParse({ page: "0" });
  assert.equal(parsed.success, false);
});

test("news query accepts valid fromTs/toTs", () => {
  const parsed = newsQuerySchema.safeParse({
    mode: "all",
    page: "1",
    limit: "20",
    fromTs: "2026-02-23T00:00:00.000Z",
    toTs: "2026-02-23T23:59:59.999Z"
  });
  assert.equal(parsed.success, true);
});

test("news query rejects invalid fromTs/toTs", () => {
  const invalidFrom = newsQuerySchema.safeParse({ page: "1", fromTs: "2026-02-23" });
  const invalidTo = newsQuerySchema.safeParse({ page: "1", toTs: "broken" });
  assert.equal(invalidFrom.success, false);
  assert.equal(invalidTo.success, false);
});
