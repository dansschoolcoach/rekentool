---
name: Participant profile concurrency
description: Why participant profile writes use an integer revision instead of an updated timestamp.
---

Participant profile updates must compare and increment an integer revision atomically. Do not replace this token with an `updated_at` comparison.

**Why:** PostgreSQL timestamps retain microseconds, while JavaScript `Date` values round-trip at millisecond precision. A freshly returned timestamp can therefore fail equality against the row that produced it, and timestamps generated close together are not guaranteed to be unique version tokens.

**How to apply:** Any participant-profile writer must submit the revision it read. The database update must match that revision and increment it in the same statement; a mismatch returns the current participant values as a conflict.