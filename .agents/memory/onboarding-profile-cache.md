---
name: Profile save navigation
description: Ordering rule for profile mutations that immediately navigate into a route protected by the same profile query.
---

When a profile mutation is followed immediately by navigation to a route guarded by that profile query, apply the successful response to the query cache before invalidating and navigating.

**Why:** Invalidation starts an asynchronous refetch, while the route guard can render synchronously with the old incomplete profile and redirect the user back to onboarding.

**How to apply:** Merge the returned participant into the current dashboard query before starting background invalidations; keep the server refetch so other dashboard fields and sessions still become fresh.