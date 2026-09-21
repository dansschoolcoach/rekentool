---
name: App browser fixtures
description: Constraints for isolated Chromium fixtures that render the full participant app.
---

When a browser fixture renders the full participant app without the production services, mock Clerk's root, internal, and theme imports together, and provide a valid test `VITE_PUBLIC_APP_URL`.

**Why:** App module initialization reads the public registration URL and imports Clerk submodules before any route component renders; omitting either leaves a blank page instead of exercising route protection.

**How to apply:** Keep the fixture API mock aligned with every statically imported client export, and make transient-query retries explicit when a test needs one deterministic failure followed by a user-triggered retry.