import { describe, expect, it } from "vitest";
import { ConfigError, databaseSsl, getConfig, normalizeDatabaseUrl } from "@/lib/server/config";

const SECRET = "config-test-secret-value-long-enough-0123456789";
const REMOTE = "postgres://user:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

/** A plain environment object, typed the way the runtime types process.env. */
function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values } as NodeJS.ProcessEnv;
}

describe("database URL resolution", () => {
  it("prefers DATABASE_URL, then falls back to the URL the Vercel Supabase integration writes", () => {
    const explicit = getConfig(
      env({
        DATABASE_URL: REMOTE,
        POSTGRES_URL: "postgres://other:pw@elsewhere.example.test:6543/postgres",
        ILMTOK_SECRET: SECRET,
      }),
    );
    expect(explicit.dbMode).toBe("postgres");
    expect(explicit.databaseUrl).toContain("aws-0-eu-central-1");

    const integration = getConfig(env({ POSTGRES_URL: `${REMOTE}?pgbouncer=true&connect_timeout=15`, ILMTOK_SECRET: SECRET }));
    expect(integration.dbMode).toBe("postgres");
    expect(integration.databaseUrl).toContain("aws-0-eu-central-1");
    expect(integration.databaseUrl).not.toContain("pgbouncer");
    expect(integration.databaseUrl).toContain("connect_timeout=15");
  });

  it("stays in demo mode when no database URL is set", () => {
    const config = getConfig(env({}));
    expect(config.dbMode).toBe("memory");
    expect(config.databaseUrl).toBeNull();
  });

  it("requires ILMTOK_SECRET as soon as a database is configured", () => {
    expect(() => getConfig(env({ DATABASE_URL: REMOTE }))).toThrow(ConfigError);
  });
});

describe("Supabase settings", () => {
  it("accepts the Supabase URL under either name and then enables Supabase storage", () => {
    const config = getConfig(
      env({
        DATABASE_URL: REMOTE,
        ILMTOK_SECRET: SECRET,
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
        VERCEL: "1",
      }),
    );
    expect(config.supabaseUrl).toBe("https://abcdefgh.supabase.co");
    expect(config.storageMode).toBe("supabase");
  });

  it("prefers SUPABASE_URL when both names are set", () => {
    const config = getConfig(
      env({
        DATABASE_URL: REMOTE,
        ILMTOK_SECRET: SECRET,
        SUPABASE_URL: "https://first.supabase.co",
        NEXT_PUBLIC_SUPABASE_URL: "https://second.supabase.co",
      }),
    );
    expect(config.supabaseUrl).toBe("https://first.supabase.co");
  });
});

describe("choosing the database URL", () => {
  it("uses an explicit DATABASE_URL even when the integration also provides one", () => {
    const config = getConfig(
      env({ DATABASE_URL: REMOTE, POSTGRES_URL: "postgres://x:y@other.example.test:5432/postgres", ILMTOK_SECRET: SECRET }),
    );
    expect(config.databaseUrl).toContain("aws-0-eu-central-1");
  });

  it("prefers the pooled integration URL over a direct one", () => {
    const direct = "postgres://postgres.abc:pw@db.abcdefgh.supabase.co:5432/postgres";
    const config = getConfig(
      env({ POSTGRES_URL: direct, POSTGRES_PRISMA_URL: `${REMOTE}?pgbouncer=true`, POSTGRES_URL_NON_POOLING: direct, ILMTOK_SECRET: SECRET }),
    );
    expect(config.databaseUrl).toContain("pooler.supabase.com");
  });

  it("falls back to the first integration URL when none is pooled", () => {
    const direct = "postgres://postgres.abc:pw@db.abcdefgh.supabase.co:5432/postgres";
    const config = getConfig(env({ POSTGRES_URL_NON_POOLING: direct, ILMTOK_SECRET: SECRET }));
    expect(config.databaseUrl).toContain("db.abcdefgh.supabase.co");
  });
});

describe("database connection settings", () => {
  it("requires TLS for remote hosts and keeps local addresses plain", () => {
    expect(databaseSsl(REMOTE)).toBe("require");
    expect(databaseSsl("postgres://u:p@localhost:5432/app")).toBe(false);
    expect(databaseSsl("postgres://u:p@127.0.0.1:5432/app")).toBe(false);
    expect(databaseSsl("postgres://u:p@[::1]:5432/app")).toBe(false);
  });

  it("drops the pgbouncer flag, keeps other settings, and leaves unparseable values alone", () => {
    const cleaned = normalizeDatabaseUrl(`${REMOTE}?pgbouncer=true&connect_timeout=15`);
    expect(cleaned).not.toContain("pgbouncer");
    expect(cleaned).toContain("connect_timeout=15");
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
    expect(normalizeDatabaseUrl(null)).toBeNull();
  });
});
