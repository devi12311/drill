/**
 * The org a browser is working in, for users in more than one. Deliberately
 * unsigned: it is only a preference — every request re-checks membership, and an
 * id the user does not belong to falls back to their first org.
 */
export const ORG_COOKIE = "drill_org";
