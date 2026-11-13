import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAdminClient } from '@supabase/server/core';

const BUCKET = 'hush-server-files';
const ENVELOPE_MAGIC = Buffer.from('HUSH1');
const SERVER_ID_PATTERN = /^srv_[a-z0-9]{6,20}$/i;
const SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

function throwSupabaseError(operation, error) {
  if (!error) return;
  if (error.code === 'PGRST205') {
    throw new Error(
      `Supabase schema is not installed or its schema cache is stale. Apply supabase/migrations/20260321000000_hush_server_storage.sql in the Supabase SQL Editor, then restart Hush. Original error: ${error.message}`,
      { cause: error }
    );
  }
  throw new Error(`Supabase ${operation} failed: ${error.message}`, { cause: error });
}

async function loadAllRows(client, table, columns, operation, filters = []) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client.from(table).select(columns);
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query.range(offset, offset + 999);
    throwSupabaseError(operation, error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function safeObjectPath(serverId, relativePath) {
  const segments = String(relativePath).split('/');
  if (!SERVER_ID_PATTERN.test(serverId)
    || !segments.length
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment))) {
    throw new Error('Invalid server file path');
  }
  return `${serverId}/${segments.join('/')}`;
}

function encryptFile(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ENVELOPE_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decryptFile(envelope, key) {
  if (envelope.length < ENVELOPE_MAGIC.length + 12 + 16
    || !envelope.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
    throw new Error('Invalid encrypted server file');
  }
  const ivStart = ENVELOPE_MAGIC.length;
  const tagStart = ivStart + 12;
  const dataStart = tagStart + 16;
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(ivStart, tagStart));
  decipher.setAuthTag(envelope.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(envelope.subarray(dataStart)), decipher.final()]);
}

function addReferencedUrl(references, serverId, value) {
  if (typeof value !== 'string') return;
  const prefix = `/uploads/server-${serverId}/`;
  if (!value.startsWith(prefix)) return;
  const relativePath = value.slice(prefix.length);
  try { references.add(safeObjectPath(serverId, relativePath)); } catch { /* malformed references are ignored */ }
}

function collectServerReferences(servers, messageRows) {
  const references = new Set();
  const activeChannels = new Map();
  for (const server of servers) {
    if (!server || typeof server.id !== 'string') continue;
    activeChannels.set(server.id, new Set(
      (Array.isArray(server.channels) ? server.channels : []).map((channel) => channel?.id).filter(Boolean)
    ));
    addReferencedUrl(references, server.id, server.iconUrl);
    for (const sound of Array.isArray(server.customSounds) ? server.customSounds : []) {
      addReferencedUrl(references, server.id, sound?.url);
      addReferencedUrl(references, server.id, sound?.imageUrl);
    }
  }
  for (const row of messageRows) {
    if (!SERVER_ID_PATTERN.test(row.server_id)
      || !activeChannels.get(row.server_id)?.has(row.channel_id)
      || !Array.isArray(row.messages)) continue;
    for (const message of row.messages) {
      addReferencedUrl(references, row.server_id, message?.attachment?.url);
    }
  }
  return references;
}

export class SupabaseServerStore {
  constructor({ client, encryptionKey } = {}) {
    if (!client) throw new Error('SupabaseServerStore requires an admin client');
    const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : Buffer.from(String(encryptionKey ?? ''), 'base64');
    if (key.length !== 32) throw new Error('HUSH_FILE_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    this.client = client;
    this.encryptionKey = key;
  }

  async init() {
    const checks = [
      ['hush_server_state', 'id'],
      ['hush_server_messages', 'server_id'],
      ['hush_server_files', 'object_path']
    ];
    for (const [table, column] of checks) {
      const { error } = await this.client.from(table).select(column).limit(1);
      throwSupabaseError(`schema check (${table})`, error);
    }
    const { error } = await this.client.storage.getBucket(BUCKET);
    throwSupabaseError(`bucket check (${BUCKET})`, error);
  }

  async loadServers() {
    const { data, error } = await this.client
      .from('hush_server_state')
      .select('servers')
      .eq('id', 'all')
      .maybeSingle();
    throwSupabaseError('load servers', error);
    return data ? data.servers : null;
  }

  async saveServers(servers) {
    const { error } = await this.client
      .from('hush_server_state')
      .upsert({ id: 'all', servers, updated_at: new Date().toISOString() });
    throwSupabaseError('save servers', error);
    await this.#markReferencedFiles(collectServerReferences(servers, []));
  }

  async loadMessages(serverId, channelId) {
    const { data, error } = await this.client
      .from('hush_server_messages')
      .select('messages')
      .eq('server_id', serverId)
      .eq('channel_id', channelId)
      .maybeSingle();
    throwSupabaseError('load channel messages', error);
    return data ? data.messages : null;
  }

  async saveMessages(serverId, channelId, messages) {
    const { error } = await this.client
      .from('hush_server_messages')
      .upsert({
        server_id: serverId,
        channel_id: channelId,
        messages,
        updated_at: new Date().toISOString()
      });
    throwSupabaseError('save channel messages', error);
    const references = collectServerReferences(
      [{ id: serverId, channels: [{ id: channelId }] }],
      [{ server_id: serverId, channel_id: channelId, messages }]
    );
    await this.#markReferencedFiles(references);
  }

  async #markReferencedFiles(references) {
    const paths = [...references];
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await this.client.from('hush_server_files')
        .update({ orphaned_at: null })
        .in('object_path', paths.slice(index, index + 100));
      throwSupabaseError('mark referenced server files', error);
    }
  }

  async deleteMessages(serverId, channelId) {
    const { error } = await this.client
      .from('hush_server_messages')
      .delete()
      .eq('server_id', serverId)
      .eq('channel_id', channelId);
    throwSupabaseError('delete channel messages', error);
  }

  async deleteServerMessages(serverId) {
    const { error } = await this.client
      .from('hush_server_messages')
      .delete()
      .eq('server_id', serverId);
    throwSupabaseError('delete server messages', error);
  }

  async getServerFileBytes(serverId) {
    const files = await loadAllRows(
      this.client,
      'hush_server_files',
      'size_bytes',
      'read server file quota',
      [['server_id', serverId]]
    );
    return files.reduce((total, file) => total + Number(file.size_bytes || 0), 0);
  }

  async uploadFile(serverId, relativePath, localPath, contentType) {
    const objectPath = safeObjectPath(serverId, relativePath);
    const plaintext = await readFile(localPath);
    const encrypted = encryptFile(plaintext, this.encryptionKey);
    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(objectPath, encrypted, { contentType: 'application/octet-stream', upsert: true });
    throwSupabaseError('upload encrypted file', uploadError);

    const { error: metadataError } = await this.client
      .from('hush_server_files')
      .upsert({
        object_path: objectPath,
        server_id: serverId,
        size_bytes: plaintext.length,
        content_type: String(contentType || 'application/octet-stream').slice(0, 100),
        orphaned_at: new Date().toISOString()
      });
    if (metadataError) {
      const { error: cleanupError } = await this.client.storage.from(BUCKET).remove([objectPath]);
      if (cleanupError) {
        metadataError.message += `; encrypted object cleanup failed: ${cleanupError.message}`;
      }
      throwSupabaseError('save encrypted file metadata', metadataError);
    }
  }

  async downloadFile(serverId, relativePath) {
    const objectPath = safeObjectPath(serverId, relativePath);
    const { data: metadata, error: metadataError } = await this.client
      .from('hush_server_files')
      .select('content_type')
      .eq('object_path', objectPath)
      .maybeSingle();
    throwSupabaseError('load encrypted file metadata', metadataError);
    if (!metadata) return null;

    const { data, error } = await this.client.storage.from(BUCKET).download(objectPath);
    if (error?.statusCode === '404' || error?.status === 404) return null;
    throwSupabaseError('download encrypted file', error);
    return {
      buffer: decryptFile(Buffer.from(await data.arrayBuffer()), this.encryptionKey),
      contentType: metadata.content_type || 'application/octet-stream'
    };
  }

  async cleanupOrphans({ now = new Date(), retentionMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    const [stateResult, messages, files] = await Promise.all([
      this.client.from('hush_server_state').select('servers').eq('id', 'all').maybeSingle(),
      loadAllRows(this.client, 'hush_server_messages', 'server_id,channel_id,messages', 'scan server messages for orphan cleanup'),
      loadAllRows(this.client, 'hush_server_files', 'object_path,server_id,orphaned_at', 'scan server files for orphan cleanup')
    ]);
    throwSupabaseError('scan server state for orphan cleanup', stateResult.error);

    const servers = Array.isArray(stateResult.data?.servers) ? stateResult.data.servers : [];
    const references = collectServerReferences(servers, messages);
    const referenced = files.filter((file) => references.has(file.object_path)).map((file) => file.object_path);
    const newlyOrphaned = files.filter((file) => !references.has(file.object_path) && !file.orphaned_at)
      .map((file) => file.object_path);
    const cutoff = now.getTime() - retentionMs;
    const expired = files.filter((file) => !references.has(file.object_path)
      && file.orphaned_at
      && Number.isFinite(Date.parse(file.orphaned_at))
      && Date.parse(file.orphaned_at) <= cutoff);

    for (let index = 0; index < referenced.length; index += 100) {
      const { error } = await this.client.from('hush_server_files')
        .update({ orphaned_at: null })
        .in('object_path', referenced.slice(index, index + 100));
      throwSupabaseError('mark referenced server files', error);
    }
    for (let index = 0; index < newlyOrphaned.length; index += 100) {
      const { error } = await this.client.from('hush_server_files')
        .update({ orphaned_at: now.toISOString() })
        .in('object_path', newlyOrphaned.slice(index, index + 100))
        .is('orphaned_at', null);
      throwSupabaseError('mark orphaned server files', error);
    }

    for (let index = 0; index < expired.length; index += 100) {
      const batch = expired.slice(index, index + 100);
      const paths = batch.map((file) => file.object_path);
      const { error: removeError } = await this.client.storage.from(BUCKET).remove(paths);
      throwSupabaseError('delete expired orphan files', removeError);
      const { error: metadataError } = await this.client.from('hush_server_files')
        .delete()
        .in('object_path', paths);
      throwSupabaseError('delete expired orphan metadata', metadataError);
    }
    return { referenced: referenced.length, markedOrphaned: newlyOrphaned.length, deleted: expired.length };
  }
}

export async function createSupabaseServerStore({ env = process.env, client, log = console } = {}) {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url && !secretKey) return null;
  if (!url || !secretKey) {
    throw new Error('Supabase requires both SUPABASE_URL and SUPABASE_SECRET_KEY');
  }
  if (!env.HUSH_FILE_ENCRYPTION_KEY?.trim()) {
    throw new Error('Supabase server storage requires HUSH_FILE_ENCRYPTION_KEY');
  }
  const store = new SupabaseServerStore({
    client: client ?? createAdminClient(),
    encryptionKey: env.HUSH_FILE_ENCRYPTION_KEY.trim()
  });
  try {
    await store.init();
  } catch (error) {
    if (error?.cause?.code !== 'PGRST205') throw error;
    log.warn?.(
      'Supabase server storage is not enabled because its schema is missing. ' +
      'Hush will continue with local server storage. Apply ' +
      'supabase/migrations/20260321000000_hush_server_storage.sql in the Supabase SQL Editor, ' +
      'then restart Hush to enable cloud storage.'
    );
    return null;
  }
  return store;
}
