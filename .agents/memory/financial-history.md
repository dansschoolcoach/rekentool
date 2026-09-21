---
name: Financial history
description: Rule for preserving historical financial dashboard results when season master data changes.
---

Saved financial months must keep using the teachers, locations, tariffs, lessons, and closures that applied when that month was saved. Later master-data edits may affect drafts and future saves, but not silently rewrite historical results.

**Why:** Coaching and season comparisons become unreliable if changing a current rate or lesson schedule retroactively changes previously reviewed months.

**How to apply:** Any new financial calculation input that can vary over time must be included in the month snapshot, or be explicitly versioned with effective dates before historical calculations use it. Preserve an explicit historical absence of a calculation instead of reconstructing it from current settings, and only show an aggregate formula when every contributing month uses compatible factors and the formula reconciles cent-exactly.