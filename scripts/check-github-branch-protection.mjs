import process from "node:process";

const REQUIRED_CHECK = "windows-codegen";
const API_VERSION = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

function checkNames(requiredStatusChecks) {
  if (!requiredStatusChecks || typeof requiredStatusChecks !== "object") {
    return [];
  }

  const contexts = Array.isArray(requiredStatusChecks.contexts)
    ? requiredStatusChecks.contexts
    : [];
  const checks = Array.isArray(requiredStatusChecks.checks)
    ? requiredStatusChecks.checks.map((check) =>
        typeof check === "string" ? check : check?.context,
      )
    : [];

  return [...contexts, ...checks].filter(
    (name) => typeof name === "string" && name.length > 0,
  );
}

function rulesetCheckNames(rule) {
  const requiredChecks = rule?.parameters?.required_status_checks;
  if (!Array.isArray(requiredChecks)) {
    return [];
  }

  return requiredChecks
    .map((check) => check?.context ?? check?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function matchesRefPattern(pattern, branch) {
  if (typeof pattern !== "string") return false;
  if (pattern === "~ALL" || pattern === "*" || pattern === "refs/heads/*") {
    return true;
  }
  if (pattern === "~DEFAULT_BRANCH") {
    return branch === "main";
  }

  const ref = `refs/heads/${branch}`;
  if (pattern === branch || pattern === ref) return true;

  if (pattern.endsWith("*")) {
    return (
      ref.startsWith(pattern.slice(0, -1)) ||
      branch.startsWith(pattern.slice(0, -1))
    );
  }

  return false;
}

function rulesetAppliesToBranch(ruleset, branch) {
  const refName = ruleset?.conditions?.ref_name;
  const includes = Array.isArray(refName?.include) ? refName.include : ["~ALL"];
  const excludes = Array.isArray(refName?.exclude) ? refName.exclude : [];

  return (
    includes.some((pattern) => matchesRefPattern(pattern, branch)) &&
    !excludes.some((pattern) => matchesRefPattern(pattern, branch))
  );
}

function activeRulesetsForBranch(rulesets, branch) {
  return (Array.isArray(rulesets) ? rulesets : []).filter(
    (ruleset) =>
      ruleset?.enforcement === "active" &&
      rulesetAppliesToBranch(ruleset, branch),
  );
}

function classicProtectionStatus(protection) {
  const requiredStatusChecks = protection?.required_status_checks;
  const names = checkNames(requiredStatusChecks);

  return {
    source: "classic branch protection",
    hasBlockingStatusChecks: names.length > 0,
    requiredCheckNames: names,
    hasRequiredWindowsCodegen: names.includes(REQUIRED_CHECK),
  };
}

function rulesetProtectionStatuses(rulesets, branch) {
  return activeRulesetsForBranch(rulesets, branch).flatMap((ruleset) =>
    (Array.isArray(ruleset.rules) ? ruleset.rules : [])
      .filter((rule) => rule?.type === "required_status_checks")
      .map((rule) => {
        const names = rulesetCheckNames(rule);
        return {
          source: `ruleset ${ruleset.name ?? ruleset.id ?? "unnamed"}`,
          hasBlockingStatusChecks: names.length > 0,
          requiredCheckNames: names,
          hasRequiredWindowsCodegen: names.includes(REQUIRED_CHECK),
        };
      }),
  );
}

export function evaluateProtection({
  branchProtection,
  rulesets = [],
  branch = "main",
}) {
  const statuses = [];

  if (branchProtection) {
    statuses.push(classicProtectionStatus(branchProtection));
  }
  statuses.push(...rulesetProtectionStatuses(rulesets, branch));

  const blockingStatusChecks = statuses.some(
    (status) => status.hasBlockingStatusChecks,
  );
  const hasRequiredWindowsCodegen = statuses.some(
    (status) => status.hasRequiredWindowsCodegen,
  );

  const failures = [];
  if (!hasRequiredWindowsCodegen) {
    failures.push(`The ${REQUIRED_CHECK} check is not required for ${branch}.`);
  }
  if (!blockingStatusChecks) {
    failures.push(
      `Required status checks do not block pending checks on ${branch}.`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    statuses,
  };
}

async function readGitHubJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof body?.message === "string" ? `: ${body.message}` : "";
    throw new GitHubApiError(
      `GitHub API request failed with HTTP ${response.status}${detail}`,
      response.status,
    );
  }

  return body;
}

async function readOptionalGitHubJson(url, token, fetchImpl) {
  try {
    return await readGitHubJson(url, token, fetchImpl);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchProtectionConfiguration({
  repository,
  branch = "main",
  token,
  apiBaseUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  }

  const encodedRepository = repository
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const encodedBranch = encodeURIComponent(branch);
  const branchProtection = await readOptionalGitHubJson(
    `${apiBaseUrl}/repos/${encodedRepository}/branches/${encodedBranch}/protection`,
    token,
    fetchImpl,
  );
  const rulesets = await readOptionalGitHubJson(
    `${apiBaseUrl}/repos/${encodedRepository}/rulesets?includes_parents=true&per_page=100`,
    token,
    fetchImpl,
  );

  return {
    branchProtection,
    rulesets: Array.isArray(rulesets) ? rulesets : [],
  };
}

function configurationError(error) {
  if (error instanceof GitHubApiError && error.status === 403) {
    return [
      error.message,
      "This workflow needs the GitHub Actions administration: read permission.",
      "If the repository policy does not grant it to GITHUB_TOKEN, use a GitHub App or fine-grained token with repository Administration: Read.",
    ].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

export async function run(options = {}) {
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const branch = options.branch ?? process.env.GITHUB_BRANCH ?? "main";
  const token =
    options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  try {
    const configuration = await fetchProtectionConfiguration({
      repository,
      branch,
      token,
      apiBaseUrl: options.apiBaseUrl,
      fetchImpl: options.fetchImpl,
    });
    const result = evaluateProtection({ ...configuration, branch });

    for (const status of result.statuses) {
      console.log(
        `${status.source}: required checks = ${
          status.requiredCheckNames.join(", ") || "(none)"
        }`,
      );
    }
    if (!result.ok) {
      throw new Error(result.failures.join("\n"));
    }
    console.log(
      `Branch protection verified: ${REQUIRED_CHECK} is required and pending checks block ${branch}.`,
    );
  } catch (error) {
    console.error(configurationError(error));
    return 1;
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run();
}
