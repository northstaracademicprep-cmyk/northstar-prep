-- Tutor hiring funnel. Additive only: nothing here changes existing tutors or students.
-- tutor_applications is written/read only by /api/tutor-apply, /api/tutor-app and
-- /api/tutor-admin with the service role key. RLS on, no policies: the anon key cannot touch it.
create table if not exists public.tutor_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  -- applied | dq | audition_pending | audition_submitted | quiz_pending | quiz_failed
  -- | review | call_pending | approved | rejected
  status text not null default 'applied',
  dq_reasons text[] not null default '{}',
  source text,                         -- referral | ad | other
  referral text,

  name text not null,
  email text not null,
  phone text,
  gender text,
  school text,
  major text,
  grad_year text,
  timezone text,

  ap_taken jsonb not null default '[]',        -- [{course, score}] from high school
  ap_can_tutor text[] not null default '{}',   -- courses they want to tutor
  other_subjects text,

  availability_schedule jsonb not null default '[]',   -- [{day, from, to}] same shape as tutors
  weekly_hours int,
  next_semester_classes text,
  commit_months int,                   -- 3 | 4 | 5 | 6
  pay_expectation numeric,
  pay_text text,
  has_ipad boolean,
  has_stylus boolean,
  can_screenshare boolean,
  whiteboard_ok boolean,
  understands_program boolean,

  audition_url text,
  audition_submitted_at timestamptz,
  quiz_answers jsonb,
  quiz_score int,
  quiz_total int,
  quiz_passed boolean,
  quiz_submitted_at timestamptz,
  rubric jsonb,                        -- {charisma, energy, clarity, analogies, absorbability, confidence, expertise} 1-5
  rubric_notes text,
  call_done boolean not null default false,
  call_notes text,
  tutor_id uuid references public.tutors(id) on delete set null
);
create index if not exists tutor_applications_status_idx on public.tutor_applications(status);
alter table public.tutor_applications enable row level security;

-- New-tutor-only fields. NULL max_students means a legacy tutor with no cap: untouched.
alter table public.tutors add column if not exists weekly_hours int;
alter table public.tutors add column if not exists max_students int;
alter table public.tutors add column if not exists gender text;
alter table public.tutors add column if not exists major text;
alter table public.tutors add column if not exists application_id uuid;
alter table public.students add column if not exists gender text;

-- Manual steps on the per-student status board (the rest is computed from existing data).
create table if not exists public.student_checklist (
  student_id uuid primary key references public.students(id) on delete cascade,
  welcome_sent boolean not null default false,
  trimmed_form_sent boolean not null default false,
  group_chat boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.student_checklist enable row level security;
