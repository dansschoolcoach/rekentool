---
name: Participant deletion compensation
description: Recovery rule for partial participant deletion across Clerk and PostgreSQL.
---

If a participant's Clerk account is successfully deleted but the database deletion rolls back, clear only the matching stale Clerk identity link in a separate database operation. Persist the deletion intent outside the deletion transaction before calling Clerk, then let retries idempotently confirm Clerk deletion before releasing the exact identity link. This leaves the participant allowlisted and able to claim the profile again with the same verified email.

**Why:** Clerk and PostgreSQL cannot share an atomic transaction. Keeping the deleted Clerk user ID would leave a profile that no account can use, while conditionally clearing that exact ID is safe if the database commit outcome is uncertain. Recording only after Clerk succeeds leaves a failure window if the database becomes fully unreachable at that exact moment.

**How to apply:** Treat Clerk user deletion (including not-found) and the conditional identity release as idempotent. Preserve the intent after ambiguous external errors; remove it only after deletion and the exact-ID database release are confirmed.