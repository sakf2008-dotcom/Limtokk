import { randomBytes } from "node:crypto";
import { cloudflareBinding, onCloudflare, runtimeEnv } from "./runtime";

/**
 * Runtime configuration, read from environment variables.
 *
 * Modes:
 *  - dbMode "postgres": DATABASE_URL is set (Supabase PostgreSQL). Durable data.
 *  - dbMode "memory":   no database configured. An in-process PostgreSQL (PGlite) is used and
 *                       seeded with DEMO content. Data is lost when the process restarts.
 *  - storageMode "supabase": Supabase Storage is configured (private + public buckets).
 *  - storageMode "demo":     local disk under .ilmtok-demo/ (development only).
 *  - storageMode "disabled": uploads are refused (e.g. demo mode on a serverless host).
 */

export type DbMode = "memory" | "postgres";
export type StorageMode = "supabase" | "demo" | "disabled" | "r2";

export class ConfigError extends Error {}

export interface AppConfig {
  dbMode: DbMode;
  storageMode: StorageMode;
  databaseUrl: string | null;
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  /** Server-side secret for HMAC hashing of tokens and device identifiers. */
  secret: string;
  secretIsEphemeral: boolean;
  adminPasswordHash: string | null;
  adminPassword: string | null;
  adminSessionSecret: string | null;
  cronSecret: string | null;
  isProduction: boolean;
  onVercel: boolean;
  /** True when no durable database is configured. The UI labels this clearly. */
  demoMode: boolean;
}

const ephemeralHolder = globalThis as unknown as { __ilmtokEphemeralSecret?: string };

/**
 * Removes connection flags that only some drivers understand. The Vercel Supabase integration adds
 * "pgbouncer=true", which postgres.js would send to the server as an unknown setting.
 */
export function normalizeDatabaseUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    // Not a parseable URL: leave it unchanged so that the driver reports the problem.
    return raw;
  }
}

/** URLs that the Vercel Supabase integration writes. */
const INTEGRATION_DATABASE_URLS = ["POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"] as const;

function isPooledUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname.includes("pooler") || url.port === "6543";
  } catch {
    return false;
  }
}

/**
 * Chooses the database URL. An explicit DATABASE_URL always wins. Otherwise the URLs written by the
 * Vercel Supabase integration are used, and the pooled one (port 6543) is preferred for serverless use.
 */
export function pickDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  const candidates = INTEGRATION_DATABASE_URLS.map((name) => env[name]?.trim()).filter((value): value is string => Boolean(value));
  return candidates.find(isPooledUrl) ?? candidates[0] ?? null;
}

/** Remote databases such as Supabase are reached over TLS. Local addresses stay plain. */
export function databaseSsl(url: string): false | "require" {
  try {
    const host = new URL(url).hostname;
    // Hyperdrive connections are proxied inside Cloudflare, and the proxy does not use TLS.
    if (host.endsWith(".hyperdrive.local")) return false;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? false : "require";
  } catch {
    return "require";
  }
}

export function getConfig(env: NodeJS.ProcessEnv = runtimeEnv()): AppConfig {
  const explicitMode = env.ILMTOK_DB_MODE?.trim();
  if (explicitMode && explicitMode !== "memory" && explicitMode !== "postgres") {
    throw new ConfigError("ILMTOK_DB_MODE must be either 'memory' or 'postgres'.");
  }

  // An explicit DATABASE_URL wins. Otherwise the URL written by the Vercel Supabase integration is used.
  const databaseUrl = normalizeDatabaseUrl(pickDatabaseUrl(env));
  let dbMode: DbMode;
  if (explicitMode === "memory") {
    dbMode = "memory";
  } else if (databaseUrl) {
    dbMode = "postgres";
  } else if (explicitMode === "postgres") {
    throw new ConfigError("DATABASE_URL is required when ILMTOK_DB_MODE=postgres.");
  } else {
    dbMode = "memory";
  }

  const rawSecret = env.ILMTOK_SECRET?.trim() ?? "";
  let secret: string;
  let secretIsEphemeral = false;
  if (rawSecret) {
    if (rawSecret.length < 32) {
      throw new ConfigError("ILMTOK_SECRET must be at least 32 characters long.");
    }
    secret = rawSecret;
  } else {
    if (dbMode === "postgres") {
      throw new ConfigError(
        "ILMTOK_SECRET is required when a database is configured (use 32+ random characters).",
      );
    }
    // Demo mode only: a per-process random secret. Tokens do not survive a restart, which is
    // acceptable because demo data does not survive a restart either.
    ephemeralHolder.__ilmtokEphemeralSecret ??= randomBytes(32).toString("base64url");
    secret = ephemeralHolder.__ilmtokEphemeralSecret;
    secretIsEphemeral = true;
  }

  const adminSessionRaw = env.ADMIN_SESSION_SECRET?.trim() ?? "";
  const adminPasswordRaw = env.ADMIN_PASSWORD ?? "";

  // SUPABASE_URL is preferred. NEXT_PUBLIC_SUPABASE_URL is the name some Supabase integrations use.
  const supabaseUrl = (env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "").replace(/\/+$/, "") || null;
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
  const onVercel = Boolean(env.VERCEL);

  let storageMode: StorageMode;
  if (dbMode === "postgres" && onCloudflare() && cloudflareBinding("MEDIA")) {
    // Cloudflare Workers: videos live in the R2 bucket bound as MEDIA.
    storageMode = "r2";
  } else if (dbMode === "postgres" && supabaseUrl && supabaseServiceKey) {
    storageMode = "supabase";
  } else if (!onVercel) {
    storageMode = "demo";
  } else {
    storageMode = "disabled";
  }

  const cronRaw = env.CRON_SECRET?.trim() ?? "";

  return {
    dbMode,
    storageMode,
    databaseUrl,
    supabaseUrl,
    supabaseServiceKey,
    secret,
    secretIsEphemeral,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH?.trim() || null,
    adminPassword: adminPasswordRaw.length >= 12 ? adminPasswordRaw : null,
    adminSessionSecret: adminSessionRaw.length >= 32 ? adminSessionRaw : null,
    cronSecret: cronRaw.length >= 16 ? cronRaw : null,
    isProduction: env.NODE_ENV === "production",
    onVercel,
    demoMode: dbMode === "memory",
  };
}
