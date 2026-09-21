---
name: Profile preference query isolation
description: User-scoped profile preferences need identity-aware client cache keys.
---

User-scoped profile preference queries must include the authenticated participant identity in their client cache key, and mutation results must update that same key.

**Why:** The endpoint path is shared across participants, so reusing a path-only cache key can let a late response from the previous participant overwrite the current participant's local choice.

**How to apply:** Add the stable participant identity to the query key whenever the financial context changes with the signed-in participant; never publish a response into a different participant's key.