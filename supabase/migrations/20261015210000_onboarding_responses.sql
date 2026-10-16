-- Parent/student onboarding form submissions (portal.northstaracademicprep.com/onboarding).
-- Written only by /api/onboarding.js with the service role key. RLS is enabled with
-- no policies, so the public anon key cannot read or write this table.
create table if not exists public.onboarding_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new',          -- new | processed
  student_id uuid references public.students(id) on delete set null,

  student_name text not null,
  student_email text,
  student_phone text,
  student_grade text,
  school text,

  parent1_name text not null,
  parent1_email text not null,
  parent1_phone text,
  parent2_name text,
  parent2_email text,
  parent2_phone text,

  preferred_contact text,                      -- iMessage | WhatsApp | Text | Email | Call
  contact_notes text,

  timezone text not null,
  preferred_days text[] not null default '{}',
  preferred_times text,
  scheduling_notes text,

  subjects text,
  teacher_name text,
  current_grade text,
  target_grade text,
  next_test_date text,
  struggles text,

  heard_about text,
  notes text
);
alter table public.onboarding_responses enable row level security;
