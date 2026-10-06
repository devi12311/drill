/**
 * Does this look like an id at all?
 *
 * Routes and pages take ids straight from the URL and read them with a query.
 * Postgres rejects a malformed uuid with `invalid input syntax for type uuid`, so
 * `/admin/monitoring/not-a-uuid` once produced a database error rather than a
 * missing page — and the error text carried the column type back to the browser.
 * A URL that cannot name a row names no row, which is a 404.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
