create table if not exists public.hush_server_state (
  id text primary key check (id = 'all'),
  servers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.hush_server_messages (
  server_id text not null,
  channel_id text not null,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (server_id, channel_id)
);

create table if not exists public.hush_server_files (
  object_path text primary key,
  server_id text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  content_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now(),
  orphaned_at timestamptz default now()
);

create index if not exists hush_server_files_server_id_idx
  on public.hush_server_files (server_id);

create index if not exists hush_server_files_orphaned_at_idx
  on public.hush_server_files (orphaned_at)
  where orphaned_at is not null;

alter table public.hush_server_state enable row level security;
alter table public.hush_server_messages enable row level security;
alter table public.hush_server_files enable row level security;

revoke all on public.hush_server_state from anon, authenticated;
revoke all on public.hush_server_messages from anon, authenticated;
revoke all on public.hush_server_files from anon, authenticated;
grant all on public.hush_server_state to service_role;
grant all on public.hush_server_messages to service_role;
grant all on public.hush_server_files to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('hush-server-files', 'hush-server-files', false, 8388641)
on conflict (id) do update
set name = excluded.name, public = false, file_size_limit = excluded.file_size_limit;
