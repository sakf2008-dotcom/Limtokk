/**
 * Builds SQL placeholders ($1, $2, ...) together with their values, so that optional filters
 * only reference parameters that are actually passed. Postgres rejects statements that contain
 * a placeholder whose type cannot be inferred, so building the list explicitly avoids that trap.
 */
export class ParamList {
  readonly values: unknown[] = [];

  ref(value: unknown, cast?: string): string {
    this.values.push(value);
    const index = this.values.length;
    return cast ? `$${index}::${cast}` : `$${index}`;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
