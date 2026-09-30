-- Stonk research graph. Public reads are sourced; browser writes are disabled.
create table if not exists public.research_companies (
  ticker text primary key,
  name text not null,
  exchange text,
  sector text,
  description text,
  source_url text,
  as_of date not null,
  coverage_note text,
  coverage_source_url text,
  updated_at timestamptz not null default now(),
  constraint research_companies_ticker_format check (ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,14}$')
);

create table if not exists public.research_relationships (
  id text primary key,
  company_ticker text not null references public.research_companies(ticker) on delete cascade,
  section text not null check (section in (
    'suppliers', 'customers', 'indices', 'competitors',
    'holders', 'analysts', 'board', 'leadership'
  )),
  name text not null,
  related_ticker text,
  detail text,
  source_url text not null check (source_url like 'https://%'),
  source_label text not null,
  as_of date not null,
  status text not null default 'documented',
  updated_at timestamptz not null default now()
);

create index if not exists research_relationships_company_section_idx
  on public.research_relationships (company_ticker, section, name);

alter table public.research_companies enable row level security;
alter table public.research_relationships enable row level security;

drop policy if exists "Public read sourced companies" on public.research_companies;
create policy "Public read sourced companies" on public.research_companies
  for select to anon, authenticated using (true);

drop policy if exists "Public read sourced relationships" on public.research_relationships;
create policy "Public read sourced relationships" on public.research_relationships
  for select to anon, authenticated using (true);

grant select on public.research_companies to anon, authenticated;
grant select on public.research_relationships to anon, authenticated;
revoke insert, update, delete on public.research_companies from anon, authenticated;
revoke insert, update, delete on public.research_relationships from anon, authenticated;
