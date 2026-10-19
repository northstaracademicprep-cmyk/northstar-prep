-- Time zones for students and tutors (IANA names, null means Pacific) and a series id
-- so weekly recurring sessions can be cancelled together.
alter table public.students add column if not exists timezone text;
alter table public.tutors add column if not exists timezone text;
alter table public.scheduled_sessions add column if not exists series_id uuid;
create index if not exists scheduled_sessions_series_idx on public.scheduled_sessions(series_id);
