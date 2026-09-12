import { generateUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

/** Base for domain entities whose new persistent identity is application-generated. */
export abstract class Entity {
  readonly id: UuidV7;

  constructor(id: UuidV7 = generateUuidV7()) {
    this.id = id;
  }
}
