import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProtection,
  fetchProtectionConfiguration,
} from "./check-github-branch-protection.mjs";

const classicProtection = {
  required_status_checks: {
    strict: true,
    contexts: ["windows-codegen"],
    checks: [{ context: "windows-codegen", app_id: -1 }],
  },
};

test("accepts classic protection with the Windows codegen check", () => {
  const result = evaluateProtection({
    branchProtection: classicProtection,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("rejects classic protection without required status checks", () => {
  const result = evaluateProtection({
    branchProtection: { required_status_checks: null },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /windows-codegen/u);
  assert.match(result.failures[1], /pending checks/u);
});

test("rejects an empty classic required-status-check configuration", () => {
  const result = evaluateProtection({
    branchProtection: {
      required_status_checks: { strict: true, contexts: [] },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /windows-codegen/u);
  assert.match(result.failures[1], /pending checks/u);
});

test("accepts an active ruleset that applies to main", () => {
  const result = evaluateProtection({
    rulesets: [
      {
        id: 42,
        name: "Protect main",
        enforcement: "active",
        conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "windows-codegen" }],
            },
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, true);
});

test("ignores disabled or unrelated rulesets", () => {
  const result = evaluateProtection({
    rulesets: [
      {
        name: "Protect a feature branch",
        enforcement: "active",
        conditions: { ref_name: { include: ["refs/heads/feature/*"] } },
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "windows-codegen" }],
            },
          },
        ],
      },
      {
        name: "Disabled main protection",
        enforcement: "disabled",
        conditions: { ref_name: { include: ["refs/heads/main"] } },
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "windows-codegen" }],
            },
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, false);
});

test("reads both GitHub endpoints with the required API headers", async () => {
  const requests = [];
  const configuration = await fetchProtectionConfiguration({
    repository: "owner/repository",
    branch: "main",
    token: "test-token",
    apiBaseUrl: "https://github.test",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        url.includes("/protection")
          ? JSON.stringify(classicProtection)
          : JSON.stringify([]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(
    configuration.branchProtection.required_status_checks.strict,
    true,
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.init.headers.Authorization, "Bearer test-token");
    assert.equal(request.init.headers["X-GitHub-Api-Version"], "2022-11-28");
  }
});
