---
name: Admin participant management
description: Security boundary for letting admins inspect and change a participant's challenge and financial data.
---

Admin management must use dedicated admin APIs whose routes explicitly identify the target participant. Never switch the Clerk session, attach an admin to a participant profile, or let admin mode instantiate participant-scoped mutation hooks.

**Why:** Admins need to correct data for a school while remaining visibly and technically logged in as themselves. Explicit target routes and a permanent management warning reduce accidental cross-school changes and identity confusion.

**How to apply:** Protect every endpoint server-side with admin authorization; scope participant, season, month, week, and tax-year records together; preserve concurrency checks; and show an unmistakable “Beheren namens deelnemer” context.