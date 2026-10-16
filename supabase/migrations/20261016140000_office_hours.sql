create table if not exists public.office_hours (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  duration_minutes int not null default 120 check (duration_minutes between 15 and 480),
  meeting_url text,
  host_tutor_id uuid references public.tutors(id) on delete set null,
  host_name text,
  topic text,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  announced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists office_hours_starts_idx on public.office_hours(starts_at);
alter table public.office_hours disable row level security;
