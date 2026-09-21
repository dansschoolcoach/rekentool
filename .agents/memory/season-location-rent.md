---
name: Season-wide location rent
description: Product rule for allocating continuing monthly venue contracts to lesson profitability.
---

For a venue charged per month, calculate the season contract total as monthly rent times the configured number of rent terms, then allocate every cent across all scheduled lesson occurrences at that venue during the season. Lesson-free months have zero direct lesson cost but do not remove a rent term from the season total.

**Why:** Venue contracts can continue through holidays and lesson-free months. Charging rent only in months containing lessons understates the real season cost and overstates lesson profit.

**How to apply:** Make the allocation closure-aware and cent-exact. Saved months keep their original allocated rent; after master-data changes, subtract those immutable historical cents and distribute only the remaining contract amount over unsaved lesson occurrences. Warn instead of silently dropping rent when a venue has no lessons.