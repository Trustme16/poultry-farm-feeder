import { AsyncLocalStorage } from 'node:async_hooks';
import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { getStore as getBlobStore } from '@netlify/blobs';

const context = new AsyncLocalStorage();

// Serialize feeder state changes across function instances, including schedule claims,
// command delivery and completion. A failed request rolls back the entire change.
export function withFeeder(handler) {
  return async (...args) => {
    const client = await getDatabase().pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(72381041)');
      const db = drizzle({ client });
      const response = await context.run(db, () => handler(...args));
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

export function getStore() {
  const db = context.getStore();
  if (!db) throw new Error('Feeder storage requires a transaction');
  const blobs = getBlobStore({ name: 'feeder', consistency: 'strong' });
  return {
    async get(key, options) {
      if (key === 'photo') return blobs.get(key, options);
      const rows = await db.execute(sql`SELECT value FROM feeder_state WHERE key = ${key}`);
      if (rows.rows.length) return rows.rows[0].value;
      // Import each legacy record once, including null, to prevent stale fallback reads.
      const value = await blobs.get(key, { type: 'json' });
      await this.setJSON(key, value);
      return value;
    },
    async setJSON(key, value) {
      await db.execute(sql`INSERT INTO feeder_state (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    },
    set: (...args) => blobs.set(...args),
    getMetadata: (...args) => blobs.getMetadata(...args),
    getWithMetadata: (...args) => blobs.getWithMetadata(...args),
  };
}
