---
name: Cross-runtime whitespace validation
description: Keep PostgreSQL empty-text checks aligned with JavaScript trim semantics.
---

For values canonicalized with JavaScript `trim()`, PostgreSQL validation must use an explicit, locale-independent list of the same whitespace characters. Do not rely on default `btrim` or `[[:space:]]` to decide whether the value is empty.

**Why:** PostgreSQL's default `btrim` removes only ordinary spaces, while its locale-dependent whitespace class can still treat Unicode characters such as non-breaking space and BOM as content. JavaScript removes those characters, so differing predicates can admit unusable database values.

**How to apply:** Whenever an API canonicalizes required text with JavaScript `trim()` and the database or a migration preflight enforces the same invariant, test ordinary spaces, tabs, newlines, non-breaking space, and BOM in both layers.