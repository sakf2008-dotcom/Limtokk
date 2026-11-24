/**
 * Runtime detection and Cloudflare bindings.
 *
 * On Cloudflare Workers (through OpenNext) every request carries its bindings (the R2 bucket and the
 * Hyperdrive connection) on a global symbol. On Vercel and in local development these are absent.
 * The app reads the symbol directly, so it never imports Cloudflare-only packages.
 */

const CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");

interface CloudflareContext {
  env?: Record<string, unknown>;
}

/** The context object of the current request, or null outside Cloudflare Workers. */
export function currentCloudflareContext(): object | null {
  const value = (globalThis as Record<PropertyKey, unknown>)[CONTEXT_SYMBOL];
  return value && typeof value === "object" ? value : null;
}

/** True only inside a Cloudflare Workers request. Cloudflare-set headers are trusted only here. */
export function onCloudflare(): boolean {
  return currentCloudflareContext() !== null;
}

/** A named binding from the Worker's configuration (for example the R2 bucket "MEDIA"). */
export function cloudflareBinding<T>(name: string): T | null {
  const context = currentCloudflareContext() as CloudflareContext | null;
  const value = context?.env?.[name];
  return value ? (value as T) : null;
}

/**
 * The environment the configuration is read from: process.env, plus the Hyperdrive connection string
 * when the Worker has a Hyperdrive binding. The connection string is never stored as a variable.
 */
export function runtimeEnv(): NodeJS.ProcessEnv {
  const hyperdrive = cloudflareBinding<{ connectionString?: string }>("HYPERDRIVE");
  if (hyperdrive?.connectionString && !process.env.DATABASE_URL) {
    return { ...process.env, DATABASE_URL: hyperdrive.connectionString };
  }
  return process.env;
}
