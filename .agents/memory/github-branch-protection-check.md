---
name: GitHub branch protection API access
description: Branch protection and ruleset inspection needs a GitHub App or fine-grained token, not the standard Actions token.
---

The standard GitHub Actions `GITHUB_TOKEN` cannot be granted the repository
Administration: Read permission required by the branch protection and ruleset
read APIs. Use a GitHub App installation token or a fine-grained token with
that repository permission, stored as a repository secret.

**Why:** The REST endpoints document Administration: Read for these token
types, while the workflow `permissions` block does not provide an equivalent
administration permission.

**How to apply:** Any CI check that reads branch protection or rulesets must
fail clearly when its dedicated token secret is missing and must never print
the token.