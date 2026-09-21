import { applicationSchema, createDatabase, pool } from "@workspace/db";
import { getTableName, type Table } from "drizzle-orm";
import { randomUUID } from "node:crypto";

type SchemaExports = Record<string, unknown>;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualifyForeignKeyReference(definition: string, schema: string, referencedTable: string): string {
  return definition.replace(
    /REFERENCES\s+(?:(?:"[^"]+"|[a-zA-Z_][\w$]*)\.)?(?:"[^"]+"|[a-zA-Z_][\w$]*)/,
    `REFERENCES ${quoteIdentifier(schema)}.${quoteIdentifier(referencedTable)}`,
  );
}

export function getApplicationTableNames(schema: SchemaExports = applicationSchema): string[] {
  const tableNames = new Set<string>();

  for (const value of Object.values(schema)) {
    try {
      const tableName = getTableName(value as Table);
      if (typeof tableName === "string") {
        tableNames.add(tableName);
      }
    } catch {
      // The schema barrel also exports validation schemas and TypeScript-only types.
    }
  }

  return [...tableNames];
}

export async function createIsolatedTestDatabase(name: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Database integration tests may not run in production.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database integration tests.");
  }

  const safeName = name.replaceAll(/[^a-z0-9_]/gi, "_").toLowerCase();
  const schema = `${safeName}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const applicationTableNames = getApplicationTableNames();
  await pool.query(`create schema "${schema}"`);

  try {
    for (const table of applicationTableNames) {
      await pool.query(`create table "${schema}"."${table}" (like public."${table}" including all)`);

      const sequenceColumns = await pool.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = $1
           and pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) is not null`,
        [table],
      );

      for (const { column_name: column } of sequenceColumns.rows) {
        const sequence = `${table}_${column}_seq`;
        await pool.query(`create sequence "${schema}"."${sequence}" owned by "${schema}"."${table}"."${column}"`);
        await pool.query(
          `alter table "${schema}"."${table}" alter column "${column}" set default nextval('"${schema}"."${sequence}"')`,
        );
      }
    }

    const foreignKeys = await pool.query<{
      constraint_name: string;
      table_name: string;
      referenced_table_name: string;
      definition: string;
    }>(
      `select pg_constraint.conname as constraint_name,
              source.relname as table_name,
              target.relname as referenced_table_name,
              pg_get_constraintdef(pg_constraint.oid, true) as definition
       from pg_constraint
       join pg_class source on source.oid = pg_constraint.conrelid
       join pg_class target on target.oid = pg_constraint.confrelid
       join pg_namespace source_namespace on source_namespace.oid = source.relnamespace
       join pg_namespace target_namespace on target_namespace.oid = target.relnamespace
       where pg_constraint.contype = 'f'
         and source_namespace.nspname = 'public'
         and target_namespace.nspname = 'public'
         and source.relname = any($1::text[])
         and target.relname = any($1::text[])`,
      [applicationTableNames],
    );

    for (const foreignKey of foreignKeys.rows) {
      const definition = qualifyForeignKeyReference(
        foreignKey.definition,
        schema,
        foreignKey.referenced_table_name,
      );
      await pool.query(
        `alter table ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.table_name)}
         add constraint ${quoteIdentifier(foreignKey.constraint_name)} ${definition}`,
      );
    }
  } catch (error) {
    await pool.query(`drop schema if exists "${schema}" cascade`);
    throw error;
  }

  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const isolated = createDatabase(url.toString());

  return {
    ...isolated,
    async dispose() {
      await isolated.pool.end();
      await pool.query(`drop schema if exists "${schema}" cascade`);
    },
  };
}