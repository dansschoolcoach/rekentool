import test from "node:test";

test("waits until the integration runner is interrupted", async () => {
  await new Promise(() => {});
});