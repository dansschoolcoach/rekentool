import { pathToFileURL } from "node:url";
import { getTableColumns, getTableName } from "drizzle-orm";
import pg from "pg";
import * as schema from "../src/schema/index.ts";

const { Pool } = pg;

export function findMissingSchemaObjects(expectedTables, actualColumns) {
  const missingTables = [];
  const missingColumns = [];

  for (const [tableName, columns] of expectedTables) {
    const actual = actualColumns.get(tableName);
    if (!actual) {
      missingTables.push(tableName);
      continue;
    }

    for (const columnName of columns) {
      if (!actual.has(columnName)) {
        missingColumns.push(`${tableName}.${columnName}`);
      }
    }
  }

  return { missingTables, missingColumns };
}

function expectedSchemaObjects() {
  const tables = new Map();

  for (const value of Object.values(schema)) {
    try {
      const tableName = getTableName(value);
      const columnNames = Object.values(getTableColumns(value)).map((column) => column.name);
      tables.set(tableName, columnNames);
    } catch {
      // The schema barrel also exports validation schemas and TypeScript-only types.
    }
  }

  return tables;
}

export async function checkDevelopmentSchema() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before checking the development database schema.");
  }

  const expectedTables = expectedSchemaObjects();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const result = await pool.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
    `);
    const actualColumns = new Map();
    for (const row of result.rows) {
      const columns = actualColumns.get(row.table_name) ?? new Set();
      columns.add(row.column_name);
      actualColumns.set(row.table_name, columns);
    }

    const missing = findMissingSchemaObjects(expectedTables, actualColumns);
    if (missing.missingTables.length === 0 && missing.missingColumns.length === 0) return;

    const details = [
      ...missing.missingTables.map((table) => `missing table public.${table}`),
      ...missing.missingColumns.map((column) => `missing column public.${column}`),
    ];
    throw new Error(
      [
        "API tests stopped: the development database schema is not synchronized with the current code.",
        ...details.map((detail) => `- ${detail}`),
        "Synchronize it with the existing database flow (`pnpm --filter @workspace/db run push`) and rerun the tests.",
        "No schema changes were applied by this check.",
      ].join("\n"),
    );
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await checkDevelopmentSchema();
}