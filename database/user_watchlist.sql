-- Customer watchlists contain tickers only. Brokerage credentials and balances
-- are never stored in this table.
create table if not exists public.user_watchlist (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,14}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.user_watchlist enable row level security;
revoke all on public.user_watchlist from anon;
revoke all on public.user_watchlist from public;
revoke all on public.user_watchlist from authenticated;
grant select, insert, delete on public.user_watchlist to authenticated;

create policy "watchlist_select_own" on public.user_watchlist
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "watchlist_insert_own" on public.user_watchlist
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "watchlist_delete_own" on public.user_watchlist
  for delete to authenticated
  using ((select auth.uid()) = user_id);
