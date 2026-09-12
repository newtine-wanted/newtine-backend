import { v7 as uuidv7 } from 'uuid';

/** UUIDv7 used for newly-created internal identifiers. */
export type UuidV7 = string & { readonly __uuidV7: unique symbol };

/**
 * Creates an RFC 9562 UUIDv7 in the application process using the maintained
 * `uuid` implementation. UUIDv7 is not a global sequence or commit order.
 */
export function generateUuidV7(): UuidV7 {
  return uuidv7() as UuidV7;
}

export function isUuidV7(value: string): value is UuidV7 {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
