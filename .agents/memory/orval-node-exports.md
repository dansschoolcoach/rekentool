---
name: Orval Node exports
description: Why direct Node.js 24 server tests can fail immediately after OpenAPI code generation.
---

Keep the Zod package barrel compatible with direct Node.js 24 ESM resolution after every OpenAPI codegen run; generated extensionless exports can prevent tests from starting.

**Why:** TypeScript accepts extensionless generated barrel exports, but the direct Node test runner rejects them before executing any test.

**How to apply:** Ensure generated file re-exports include `.ts` and the workspace barrel names `types/index.ts` rather than importing the directory. After codegen, verify the full typecheck and a direct API server test.