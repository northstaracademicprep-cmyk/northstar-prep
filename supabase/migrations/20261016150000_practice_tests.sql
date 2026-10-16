create table if not exists public.practice_tests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  bank_type text not null,
  label text,
  section text not null default 'mcq' check (section in ('mcq','frq')),
  total int not null,
  correct int not null,
  seconds_used int,
  seconds_allowed int,
  unit_breakdown jsonb,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists practice_tests_student_idx on public.practice_tests(student_id, created_at desc);
alter table public.practice_tests disable row level security;
