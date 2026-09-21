---
name: Published-release smoke checks
description: Placement of live HTTP checks for static artifact releases.
---

For a static artifact, do not run a smoke check against the production URL from the production build and describe it as verification of that release. The build runs before publication, so it can only see the previous live release.

**Why:** A release that breaks a published route would remain live and would only be detected during the next build.

**How to apply:** Use a genuine successful post-deployment event, check out the deployed revision, and then run the live HTTP check with bounded retries and request timeouts. Keep local output validation as a separate pre-deploy gate.