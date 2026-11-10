import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSupabaseServerStore, SupabaseServerStore } from '../src/supabase-server-store.js';
import { ServerManager } from '../src/servers.js';
import { createHushServer } from '../src/app.js';

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.action = 'select';
    this.filters = [];
  }

  select() { return this; }
  limit() { return this; }
  range(start, end) { this.rangeStart = start; this.rangeEnd = end; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  is(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  upsert(value) { this.action = 'upsert'; this.value = value; return this; }
  update(value) { this.action = 'update'; this.value = value; return this; }
  delete() { this.action = 'delete'; return this; }

  async maybeSingle() {
    const { data, error } = await this.execute();
    return { data: data?.[0] ?? null, error };
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async execute() {
    const rows = this.client.tables.get(this.table);
    if (this.action === 'upsert') {
      const key = this.table === 'hush_server_state'
        ? 'id'
        : this.table === 'hush_server_messages'
          ? null
          : 'object_path';
      const index = key ? rows.findIndex((row) => row[key] === this.value[key]) : rows.findIndex(
        (row) => row.server_id === this.value.server_id && row.channel_id === this.value.channel_id
      );
      if (index < 0) rows.push({ ...this.value });
      else rows[index] = { ...rows[index], ...this.value };
      return { data: null, error: null };
    }

    const matching = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action === 'update') {
      for (const row of matching) Object.assign(row, this.value);
    } else if (this.action === 'delete') {
      this.client.tables.set(this.table, rows.filter((row) => !matching.includes(row)));
    }
    const data = this.action === 'select'
      ? matching.slice(this.rangeStart ?? 0, (this.rangeEnd ?? matching.length - 1) + 1)
      : null;
    return { data, error: null };
  }
}

function createMockSupabase() {
  const tables = new Map([
    ['hush_server_state', []],
    ['hush_server_messages', []],
    ['hush_server_files', []]
  ]);
  const objects = new Map();
  const client = {
    tables,
    from(table) {
      assert.ok(tables.has(table), `unexpected table: ${table}`);
      return new MockQuery(client, table);
    },
    storage: {
      async getBucket() { return { data: { id: 'hush-server-files' }, error: null }; },
      from() {
        return {
          async upload(objectPath, body) {
            objects.set(objectPath, Buffer.from(body));
            return { data: { path: objectPath }, error: null };
          },
          async download(objectPath) {
            const body = objects.get(objectPath);
            return body
              ? { data: new Blob([body]), error: null }
              : { data: null, error: { statusCode: '404', message: 'not found' } };
          },
          async remove(paths) {
            for (const objectPath of paths) objects.delete(objectPath);
            return { data: [], error: null };
          }
        };
      }
    }
  };
  return { client, tables, objects };
}

test('Supabase server files are encrypted at rest and decrypt on download', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hush-supabase-file-'));
  try {
    const source = path.join(directory, 'image.png');
    const plaintext = Buffer.from('private server attachment');
    await writeFile(source, plaintext);
    const { client, objects } = createMockSupabase();
    const store = new SupabaseServerStore({
      client,
      encryptionKey: Buffer.alloc(32, 7)
    });
    await store.init();
    await store.uploadFile('srv_123abc', 'general/image.png', source, 'image/png');

    const stored = objects.get('srv_123abc/general/image.png');
    assert.notDeepEqual(stored, plaintext);
    assert.equal(stored.subarray(0, 5).toString(), 'HUSH1');
    const downloaded = await store.downloadFile('srv_123abc', 'general/image.png');
    assert.deepEqual(downloaded.buffer, plaintext);
    assert.equal(downloaded.contentType, 'image/png');
    assert.equal(await readFile(source, 'utf8'), plaintext.toString());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing Supabase migration reports the exact setup action', async () => {
  const store = new SupabaseServerStore({
    client: {
      from(table) {
        return {
          select() { return this; },
          limit() { return Promise.resolve({
            data: null,
            error: table === 'hush_server_state'
              ? { code: 'PGRST205', message: "Could not find the table 'public.hush_server_state' in the schema cache" }
              : null
          }); }
        };
      }
    },
    encryptionKey: Buffer.alloc(32, 3)
  });
  await assert.rejects(
    store.init(),
    /Apply supabase\/migrations\/20260321000000_hush_server_storage\.sql in the Supabase SQL Editor/
  );
});

test('missing Supabase migration falls back to local storage without stopping startup', async () => {
  const warnings = [];
  const store = await createSupabaseServerStore({
    env: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'test-secret',
      HUSH_FILE_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64')
    },
    client: {
      from() {
        return {
          select() { return this; },
          limit() {
            return Promise.resolve({
              data: null,
              error: { code: 'PGRST205', message: "Could not find the table 'public.hush_server_state' in the schema cache" }
            });
          }
        };
      }
    },
    log: { warn: (warning) => warnings.push(warning) }
  });
  assert.equal(store, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /continue with local server storage/);
  assert.match(warnings[0], /Apply supabase\/migrations\/20260321000000_hush_server_storage\.sql/);
});

test('Supabase orphan cleanup retains referenced files then deletes after 30 days', async () => {
  const { client, tables, objects } = createMockSupabase();
  const store = new SupabaseServerStore({
    client,
    encryptionKey: Buffer.alloc(32, 9)
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hush-supabase-cleanup-'));
  try {
    const source = path.join(directory, 'icon.png');
    await writeFile(source, 'icon');
    await store.uploadFile('srv_123abc', 'icon.png', source, 'image/png');
    await store.saveServers([{ id: 'srv_123abc', iconUrl: '/uploads/server-srv_123abc/icon.png' }]);
    assert.equal(tables.get('hush_server_files')[0].orphaned_at, null);

    assert.equal(objects.has('srv_123abc/icon.png'), true);

    await store.saveServers([]);
    await store.cleanupOrphans({ now: new Date('2026-03-02T00:00:00Z') });
    assert.ok(tables.get('hush_server_files')[0].orphaned_at);
    await store.cleanupOrphans({ now: new Date('2026-04-02T00:00:00Z') });
    assert.equal(tables.get('hush_server_files').length, 0);
    assert.equal(objects.has('srv_123abc/icon.png'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('server metadata and channel messages restore from the injected cloud store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hush-supabase-servers-'));
  const store = {
    state: null,
    messages: new Map(),
    async loadServers() { return this.state; },
    async saveServers(servers) { this.state = structuredClone(servers); },
    async loadMessages(serverId, channelId) {
      return this.messages.get(`${serverId}/${channelId}`) ?? null;
    },
    async saveMessages(serverId, channelId, messages) {
      this.messages.set(`${serverId}/${channelId}`, structuredClone(messages));
    },
    async deleteMessages() {},
    async deleteServerMessages() {}
  };
  try {
    const first = new ServerManager({ dataDir: path.join(directory, 'first'), serverStore: store });
    await first.init();
    const server = await first.create({
      name: 'Cloud server',
      ownerName: 'Owner',
      ownerDeviceId: 'device-server1'
    });
    const channel = server.channels.find((item) => item.type === 'text');
    await first.addMessage(server.id, channel.id, {
      id: 'cloud-message',
      type: 'text',
      text: 'persisted',
      channelId: channel.id
    });

    const restarted = new ServerManager({ dataDir: path.join(directory, 'second'), serverStore: store });
    await restarted.init();
    assert.equal(restarted.get(server.id).name, 'Cloud server');
    assert.equal((await restarted.loadMessages(server.id, channel.id))[0].text, 'persisted');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('server file requests are served from private cloud storage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hush-supabase-route-'));
  const content = Buffer.from('decrypted cloud file');
  const store = {
    async loadServers() { return null; },
    async saveServers() {},
    async loadMessages() { return null; },
    async saveMessages() {},
    async deleteMessages() {},
    async deleteServerMessages() {},
    async cleanupOrphans() {},
    async downloadFile(serverId, relativePath) {
      assert.equal(serverId, 'srv_123abc');
      assert.equal(relativePath, 'icon.png');
      return { buffer: content, contentType: 'image/png' };
    }
  };
  const hush = await createHushServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(directory, 'data'),
    uploadsDir: path.join(directory, 'uploads'),
    serverStore: store
  });
  try {
    const address = await hush.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/uploads/server-srv_123abc/icon.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
  } finally {
    await hush.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
