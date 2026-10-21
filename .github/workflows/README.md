# GitHub workflow requirements

## Main branch protection check

`check-branch-protection.yml` reads both of GitHub's protection configuration
surfaces for `main`:

- classic branch protection via
  `GET /repos/{owner}/{repo}/branches/main/protection`;
- active repository rulesets via
  `GET /repos/{owner}/{repo}/rulesets`.

The check fails unless an applicable configuration requires the
`windows-codegen` job and has required status checks enabled, so a pending
check blocks merging.

The standard Actions `GITHUB_TOKEN` cannot be granted this API permission.
Before enabling the workflow, connect a GitHub App with repository
**Administration: Read** access or create a fine-grained token with the same
repository permission. Store the resulting token in the repository secret
`BRANCH_PROTECTION_TOKEN`. The workflow checks that this secret exists without
printing its value and passes it only to the API checker; never commit the
token.

## Live verification

On 2026-10-21, **Check main branch protection** completed successfully via
`workflow_dispatch` on `main`:

- [Successful manual run](https://github.com/dansschoolcoach/rekentool/actions/runs/39671084909)
- The log reports `classic branch protection: required checks = windows-codegen`
  and confirms that pending checks block merging to `main`.
- Both the classic branch protection endpoint and the rulesets endpoint are read
  by the executed checker. The repository currently has no active rulesets, so
  this run verifies classic protection plus successful access to the rulesets
  list, not enforcement through a populated ruleset.
- Both token environment entries are masked as `***` in the job log. No
  unmasked GitHub-token patterns were found.
- All checker fixture tests and the live API verification step passed.

The workflows were published through GitHub pull requests
[1](https://github.com/dansschoolcoach/rekentool/pull/1) and
[2](https://github.com/dansschoolcoach/rekentool/pull/2). The `windows-codegen`
check is configured as a required check on `main`.

The daily schedule is `06:17 UTC` (07:17 Amsterdam winter time or 08:17 summer
time); GitHub scheduled jobs may start later. Renew the repository secret before
the underlying token expires. Do not put its value in this document, chat, or
source code.
