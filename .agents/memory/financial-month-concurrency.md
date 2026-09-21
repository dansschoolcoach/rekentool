---
name: Financial month concurrency
description: Optimistic concurrency rule for financial month editing across users and repeated saves.
---

Financial month writes must be based on the revision read when the editor loaded the month. A stale or missing revision for an existing month is a conflict, not permission to overwrite.

**Why:** Multiple users can edit the same month, and even one user can save repeatedly from the same open screen. Silent last-writer-wins behavior loses valid input; failing to advance the local revision after a successful save causes false conflicts.

**How to apply:** Return the new revision from every successful month write and immediately adopt it in the client while preserving edits made during the request. Serialize creation and replacement per month so two first saves with an empty revision cannot both win.

Conflict recovery must retain the rejected submission until the user explicitly chooses a version, including when loading the latest server version fails.

**Why:** A conflict already means the submitted changes were not saved; discarding them after a transient reload failure compounds that failure into user-visible data loss.

**How to apply:** Keep a separate immutable copy of the rejected submission throughout retries. A failed or mismatched reload may report an error and reset its loading state, but must not clear or replace that copy.

Season master-data writes and month snapshots must also be serialized per season. The transaction that acquires the shared season lock first wins the ordering: a month persists either the complete previously committed season version or the complete newly committed version, never a mixture.

**Why:** A snapshot assembled outside the month transaction can combine season-level values, teachers, locations, and lessons from different commits while a full season replacement is underway.

**How to apply:** Acquire the shared season lock before any narrower month lock, then re-read the season and all snapshot data inside that transaction. This applies equally to normal saves and legacy snapshot migrations. Revalidate month boundaries and build the response from this ordered version. Keep the same lock order everywhere to avoid deadlocks.

Season master-data editors must also use optimistic concurrency based on the season revision they loaded. Compare that revision only after acquiring the shared season lock, and advance the revision on every successful complete replacement.

**Why:** The lock orders season and month transactions but does not by itself stop two administrators from sequentially replacing the same season based on one stale version.

**How to apply:** Return the season revision in list and detail responses, require it on updates, and reject a mismatch as a conflict before changing any season or child master data.