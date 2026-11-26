-- How soon an applicant can start. 3 weeks or more is an auto-DQ (see api/_tutor-rules.js).
alter table public.tutor_applications add column if not exists start_timing text;
