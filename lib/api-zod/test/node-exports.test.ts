import assert from "node:assert/strict";
import test from "node:test";

import { HealthCheckResponse } from "@workspace/api-zod";

test("@workspace/api-zod loads its generated exports in Node", () => {
  const result = HealthCheckResponse.safeParse({ status: "ok" });

  assert.equal(result.success, true);
});