create table if not exists public.scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid references public.tutors(id) on delete set null,
  starts_at timestamptz not null,
  duration_minutes int not null default 60 check (duration_minutes between 15 and 480),
  topic text,
  meeting_url text,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  created_by text not null default 'admin' check (created_by in ('student','tutor','admin')),
  created_at timestamptz not null default now()
);
create index if not exists scheduled_sessions_student_idx on public.scheduled_sessions(student_id, starts_at);
create index if not exists scheduled_sessions_tutor_idx on public.scheduled_sessions(tutor_id, starts_at);

create table if not exists public.session_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid references public.tutors(id) on delete set null,
  scheduled_session_id uuid references public.scheduled_sessions(id) on delete cascade,
  kind text not null check (kind in ('new','reschedule','cancel')),
  proposed_starts_at timestamptz,
  proposed_duration_minutes int check (proposed_duration_minutes is null or proposed_duration_minutes between 15 and 480),
  reason text,
  requested_by text not null default 'student' check (requested_by in ('student','tutor','admin')),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists session_requests_status_idx on public.session_requests(status, created_at);
create index if not exists session_requests_student_idx on public.session_requests(student_id);

alter table public.scheduled_sessions disable row level security;
alter table public.session_requests disable row level security;
