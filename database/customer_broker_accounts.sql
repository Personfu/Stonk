-- Server-owned binding between a confirmed STONK user and one Alpaca Broker
-- account. Never grant browser roles access to this table or accept an account
-- ID from a browser request for balances, funding, or orders.
create table if not exists public.customer_broker_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  broker_account_id uuid not null unique,
  broker_environment text not null check (broker_environment in ('sandbox', 'live')),
  created_at timestamptz not null default now()
);

alter table public.customer_broker_accounts enable row level security;
revoke all on public.customer_broker_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.customer_broker_accounts to service_role;

comment on table public.customer_broker_accounts is
  'Broker account ownership bindings written only after broker identity approval; never exposed to browser roles.';

