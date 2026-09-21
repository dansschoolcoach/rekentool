---
name: ExcelJS row values
description: Non-obvious ExcelJS behavior when constructing round-tripped worksheet rows for import tests.
---

When constructing XLSX fixtures for import tests, set cells individually with `getCell(column).value` rather than relying on `Row.values` array offsets after loading a workbook.

**Why:** ExcelJS can expose sparse row values with a leading empty slot, and assigning an array that appears one-based can shift every imported value after the workbook is written and loaded again.

**How to apply:** Use `getCell(index + 1).value` for fixture rows, then test the serialized-and-reloaded workbook rather than only the in-memory workbook.