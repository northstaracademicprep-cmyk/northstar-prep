alter table public.scheduled_sessions add column if not exists reminder_sent_at timestamptz;
alter table public.session_requests add column if not exists notified_at timestamptz;
alter table public.session_requests add column if not exists decision_notified_at timestamptz;
