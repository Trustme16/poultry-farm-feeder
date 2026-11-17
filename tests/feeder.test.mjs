import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';

// Exercise the real transaction wrapper and endpoints with a fake PostgreSQL
// transport, including contention for its transaction-scoped advisory lock.
async function fixture() {
  const records = new Map();
  let tail = Promise.resolve();
  const pool = { async connect() {
    let unlock, snapshot;
    return {
      async query(query, values = []) {
        const text = typeof query === 'string' ? query : query.text;
        if (text === 'BEGIN') return { rows: [] };
        if (text.includes('pg_advisory_xact_lock')) {
          const prior = tail; tail = new Promise(r => { unlock = r; });
          await prior; snapshot = structuredClone(records); return { rows: [] };
        }
        if (text === 'COMMIT' || text === 'ROLLBACK') {
          if (text === 'ROLLBACK' && snapshot) { records.clear(); for (const [k,v] of snapshot) records.set(k,v); }
          unlock?.(); return { rows: [] };
        }
        if (text.startsWith('SELECT value')) return { rows: records.has(values[0]) ? [{ value: structuredClone(records.get(values[0])) }] : [] };
        if (text.startsWith('INSERT INTO feeder_state')) {
          records.set(values[0], JSON.parse(values[1])); return { rows: [] };
        }
        throw new Error('Unexpected query: ' + text);
      }, release() {},
    };
  }};
  let photo = null;
  const blobStore = {
    get: async () => null,
    getMetadata: async () => photo ? { metadata: photo } : null,
    set: async (key, value, opts) => { photo = opts.metadata; },
  };
  const context = vm.createContext({ Response, Request, URL, Date, console, process: {env:{}}, crypto: webcrypto });
  const modules = new Map();
  const mocks = {
    '@netlify/database': { getDatabase: () => ({ pool }) },
    '@netlify/blobs': { getStore: () => blobStore },
    'drizzle-orm/node-postgres': { drizzle }, 'drizzle-orm': { sql },
    'node:async_hooks': { AsyncLocalStorage },
  };
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    let module;
    if (mocks[path]) {
      const exports = mocks[path];
      module = new vm.SyntheticModule(Object.keys(exports), function () { for (const [k,v] of Object.entries(exports)) this.setExport(k,v); }, { context, identifier: path });
    } else if (path.endsWith('/auth.mjs')) {
      const exports = { isDevice: () => true, getUser: req => req.headers.get('x-user') || 'admin', isAdmin: user => user === 'admin', json: (data,status=200) => Response.json(data,{status}) };
      module = new vm.SyntheticModule(Object.keys(exports), function () { for (const [k,v] of Object.entries(exports)) this.setExport(k,v); }, { context, identifier:path });
    } else {
      module = new vm.SourceTextModule(await readFile(new URL(path), 'utf8'), { context, identifier:path });
    }
    modules.set(path,module);
    await module.link((specifier, parent) => load(specifier.startsWith('.') ? new URL(specifier,parent.identifier).href : specifier));
    return module;
  }
  async function call(name, method='GET', body, user='admin') {
    const module = await load(new URL('../netlify/functions/'+name+'.mjs',import.meta.url).href);
    if (module.status !== 'evaluated') await module.evaluate();
    return module.namespace.default(new Request('https://farm.test/api/'+name, { method, headers:{'x-user':user}, ...(body ? {body:JSON.stringify(body)} : {}) }));
  }
  return { records, call };
}

test('concurrent scheduled polls deliver one feed; completion retries do not repeat it', async () => {
  const f = await fixture();
  const { localParts } = await import('../netlify/lib/time.mjs');
  f.records.set('settings', {schedule:[{time:localParts().time, seconds:7}]});
  // Warm module linking before concurrent invocation.
  await f.call('device','POST',{id:'unknown'});
  const results = await Promise.all(Array.from({length:12}, async () => (await f.call('device')).json()));
  const feeds = results.filter(r=>r.feed);
  assert.equal(feeds.length,1);
  assert.equal(feeds[0].seconds,7);
  await f.call('device','POST',{id:feeds[0].id});
  await f.call('device','POST',{id:feeds[0].id});
  assert.equal((await (await f.call('device')).json()).feed,false);
  assert.equal(f.records.get('history').length,1);
});

test('admin timer accepts custom seconds and rejects duplicates, invalid timers and non-admin edits', async () => {
  const f = await fixture();
  const body = {dailyLimit:5, schedule:[{time:'08:00',seconds:7}],cameraMode:'manual'};
  assert.equal((await f.call('settings','PUT',body)).status,200);
  assert.equal(f.records.get('settings').schedule[0].seconds,7);
  assert.equal((await f.call('settings','PUT',body,'viewer')).status,403);
  assert.equal((await f.call('settings','PUT',{...body,schedule:[...body.schedule,...body.schedule]})).status,400);
  assert.equal((await f.call('settings','PUT',{...body,schedule:[{time:'08:00',seconds:31}]})).status,400);
});

test('manual photo works before any feeding, failed uploads retry, modes control automatic capture', async () => {
  const f = await fixture();
  f.records.set('camera',{t:Date.now(),ip:'192.168.1.10'});
  f.records.set('settings',{cameraMode:'manual'});
  assert.equal((await f.call('photo','PUT')).status,200);
  const first = await (await f.call('camera')).json();
  assert.equal(first.snap,true);
  assert.equal((await (await f.call('camera')).json()).id,first.id);
  f.records.set('photoReq',null);
  f.records.set('command',{id:'feed1',status:'done',createdAt:Date.now(),seconds:7,user:'admin'});
  assert.equal((await (await f.call('camera')).json()).snap,false);
  f.records.set('settings',{cameraMode:'after-feed'});
  assert.equal((await (await f.call('camera')).json()).id,'feed1');
  f.records.set('photoReq',null);
  f.records.set('settings',{cameraMode:'live'});
  const live = await (await f.call('camera')).json();
  assert.equal(live.snap,true);
  assert.notEqual(live.id,'feed1');
});
