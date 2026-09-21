---
name: Financial offer imports
description: Business mapping between the fixed Excel template and existing financial offer fields.
---

The fixed Excel template always supplies a monthly subscription price. Convert that at import time to the existing form semantics: selected-period price for recurring frequencies and total contract price for installments. Because the template has no separate installment-count column, an installment plan uses its duration in months as its count of monthly installments.

**Why:** Storing the spreadsheet value directly would make non-monthly subscriptions differ from equivalent manual entries and distort revenue. Rejecting installments would make one of the template's provided choices unusable.

**How to apply:** Keep this mapping whenever the fixed spreadsheet template is parsed or replaced. If the template gains explicit period-price or installment-count fields, revisit the mapping rather than silently combining old and new meanings.