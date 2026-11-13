import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env']) {
  const { error } = dotenv.config({ path: path.join(root, file) });
  if (error && error.code !== 'ENOENT') throw error;
}

let failures = 0;
const ok = (message) => console.log(`  [OK]  ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  [!!]  ${message}`);
};

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_SECRET_KEY || '').trim();
const encryptionKey = (process.env.HUSH_FILE_ENCRYPTION_KEY || '').trim();

console.log('1) Environment');
if (/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) ok('SUPABASE_URL format is valid');
else fail('SUPABASE_URL must be https://<project-ref>.supabase.co without a path');

if (key.startsWith('sb_secret_') || key.startsWith('eyJ')) ok('SUPABASE_SECRET_KEY is configured');
else fail('SUPABASE_SECRET_KEY is missing or has an unsupported format');

try {
  if (Buffer.from(encryptionKey, 'base64').length === 32) ok('HUSH_FILE_ENCRYPTION_KEY is 32 bytes');
  else fail('HUSH_FILE_ENCRYPTION_KEY must be base64-encoded 32-byte data');
} catch {
  fail('HUSH_FILE_ENCRYPTION_KEY must be valid Base64');
}

if (!url || !key) {
  console.log('\nCannot test the connection until SUPABASE_URL and SUPABASE_SECRET_KEY are set.');
  process.exit(1);
}

const headers = { apikey: key };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

async function get(pathname) {
  return fetch(`${url}${pathname}`, {
    headers,
    signal: AbortSignal.timeout(10_000)
  });
}

console.log('\n2) Database connection');
try {
  const response = await get('/rest/v1/');
  if (!response.ok) {
    fail(`PostgREST returned HTTP ${response.status}`);
  } else {
    const specification = await response.json();
    const tables = Object.keys(specification.paths || {}).filter((entry) => entry !== '/');
    ok(`PostgREST is reachable; exposed endpoints: ${tables.length}`);
    for (const table of ['hush_server_state', 'hush_server_messages', 'hush_server_files']) {
      if (specification.paths?.[`/${table}`]) ok(`${table} is available`);
      else fail(`${table} is not exposed; apply the Hush migration and refresh the schema cache`);
    }
  }
} catch {
  fail('Could not reach PostgREST; check network access and the Supabase project URL');
}

console.log('\n3) Private file storage');
try {
  const response = await get('/storage/v1/bucket');
  if (!response.ok) {
    fail(`Supabase Storage returned HTTP ${response.status}`);
  } else {
    const buckets = await response.json();
    const bucket = buckets.find((entry) => entry.id === 'hush-server-files');
    if (!bucket) fail('hush-server-files bucket is missing; apply the Hush migration');
    else if (bucket.public) fail('hush-server-files is public; make the bucket private');
    else ok('hush-server-files exists and is private');
  }
} catch {
  fail('Could not reach Supabase Storage; check the project URL and secret key');
}

console.log(failures ? `\nFinished with ${failures} problem(s).` : '\nFinished: Supabase is ready.');
process.exitCode = failures ? 1 : 0;
