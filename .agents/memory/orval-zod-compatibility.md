---
name: Orval Zod compatibility
description: A generator/runtime version mismatch that affects OpenAPI schema choices in this workspace.
---

Orval's current Zod client emits top-level `zod.int()` and `zod.email()` helpers, while the workspace catalog still resolves Zod 3, where those helpers do not exist.

**Why:** Code generation succeeds but the chained library typecheck fails, which makes the failure look like an OpenAPI problem.

**How to apply:** Until the workspace moves to Zod 4, model integer semantics as OpenAPI `number` and validate whole-number constraints at the application boundary; avoid `format: email` in generated request/response schemas or validate it separately.