create table if not exists providers (
  id text primary key,
  url text not null,
  ownername text,
  price numeric(38, 18),
  location text,
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$')
);

create table if not exists keys (
  id text primary key,
  key text not null unique,
  provider_id text not null references providers(id),
  epoch bigint not null,
  coinbase text,
  inviter text,
  free boolean not null default false,
  mined boolean not null default false,
  hash text check (hash is null or hash ~ '^0x[0-9a-fA-F]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coinbase is null or coinbase ~ '^0x[0-9a-fA-F]{40}$'),
  check (inviter is null or inviter ~ '^0x[0-9a-fA-F]{40}$')
);

create index if not exists keys_available_idx
  on keys (provider_id, epoch, free, id)
  where coinbase is null;

create index if not exists keys_coinbase_epoch_idx
  on keys (coinbase, epoch)
  where coinbase is not null;

create unique index if not exists keys_hash_unique_idx
  on keys (lower(hash))
  where hash is not null;
