-- Separate manager logins for delegated hiring, matching and student/tutor management (/manage).
-- Written and read only by /api/onboarding?r=tutor-admin with the service role. RLS on, no policies.
create table if not exists public.staff_access (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  code text not null unique,
  role text not null default 'manager',
  active boolean not null default true,
  last_login timestamptz
);
alter table public.staff_access enable row level security;
