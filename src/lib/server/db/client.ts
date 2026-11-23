import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { ConfigError, getConfig } from "../config";
import { MIGRATIONS } from "./schema";
import { seedDemoData } from "./demo-seed";

export type Row = Record<string, unknown>;

/** Minimal SQL surface used by the repositories. Parameters use $1, $2, ... placeholders. */
export interface SqlExecutor {
  query<T extends object = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs one or more statements without parameters. */
  exec(text: string): Promise<void>;
}

export interface Sql extends SqlExecutor {
  readonly kind: "memory" | "postgres";
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface DbState {
  ready?: Promise<Sql>;
}

const globalState = globalThis as unknown as { __ilmtokDb?: DbState };

function dbState(): DbState {
  globalState.__ilmtokDb ??= {};
  return globalState.__ilmtokDb;
}

interface PgLikeQuery {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (text: string) => Promise<unknown>;
}

function executorFrom(pg: PgLikeQuery): SqlExecutor {
  return {
    async query<T extends object = Row>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await pg.query(text, params ? [...params] : undefined);
      return result.rows as T[];
    },
    async exec(text: string): Promise<void> {
      await pg.exec(text);
    },
  };
}

function wrapPglite(pg: PGlite): Sql {
  const base = executorFrom(pg as unknown as PgLikeQuery);
  return {
    kind: "memory",
    ...base,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return pg.transaction((tx) => fn(executorFrom(tx as unknown as PgLikeQuery)));
    },
    async close(): Promise<void> {
      await pg.close();
    },
  };
}

type PostgresClient = ReturnType<typeof postgres>;

function wrapPostgres(client: PostgresClient): Sql {
  const toExecutor = (runner: { unsafe: PostgresClient["unsafe"] }): SqlExecutor => ({
    async query<T extends object = Row>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const rows = await runner.unsafe(text, params ? ([...params] as never[]) : []);
      return Array.from(rows) as unknown as T[];
    },
    async exec(text: string): Promise<void> {
      await runner.unsafe(text);
    },
  });

  const base = toExecutor(client);
  return {
    kind: "postgres",
    ...base,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const result = await client.begin((tx) => fn(toExecutor(tx as unknown as { unsafe: PostgresClient["unsafe"] })));
      return result as unknown as T;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

async function openMemory(): Promise<Sql> {
  const pg = new PGlite();
  await pg.waitReady;
  return wrapPglite(pg);
}

function openPostgres(url: string): Sql {
  const client = postgres(url, {
    max: 5,
    // Required for Supabase's transaction pooler (port 6543), which does not support prepared statements.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  return wrapPostgres(client);
}

/** Applies pending schema migrations. Safe to call from several serverless instances at once. */
export async function migrate(db: Sql): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    await db.transaction(async (tx) => {
      // Transaction-scoped advisory lock: concurrent cold starts wait instead of racing.
      await tx.query("SELECT pg_advisory_xact_lock(725190341)");
      const done = await tx.query("SELECT id FROM schema_migrations WHERE id = $1", [migration.id]);
      if (done.length > 0) return;
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
      applied.push(migration.id);
    });
  }
  return applied;
}

/**
 * Returns a migrated database connection. The first call opens the connection, applies migrations
 * and (in demo mode) seeds demo content. Later calls reuse the same promise.
 */
export function getDb(): Promise<Sql> {
  const state = dbState();
  if (!state.ready) {
    state.ready = (async () => {
      const config = getConfig();
      let db: Sql;
      if (config.dbMode === "postgres") {
        if (!config.databaseUrl) throw new ConfigError("DATABASE_URL is missing.");
        db = openPostgres(config.databaseUrl);
      } else {
        db = await openMemory();
      }
      await migrate(db);
      if (config.dbMode === "memory") {
        await seedDemoData(db);
      }
      return db;
    })();
    state.ready.catch(() => {
      // Allow a later request to retry after a transient failure.
      dbState().ready = undefined;
    });
  }
  return state.ready;
}

/** Test helper: closes the connection and forgets it, so the next call starts a fresh database. */
export async function resetDbForTests(): Promise<void> {
  const state = dbState();
  const current = state.ready;
  state.ready = undefined;
  if (current) {
    try {
      const db = await current;
      await db.close();
    } catch {
      // Initialization failed earlier; nothing to close.
    }
  }
}
