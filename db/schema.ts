import { pgTable, text, jsonb } from 'drizzle-orm/pg-core';

// Named feeder records preserve existing configuration during the Blobs migration.
export const feederState = pgTable('feeder_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
