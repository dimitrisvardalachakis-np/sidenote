-- Cut the demo queue to six cases.
--
-- Written as a keep-list rather than a kill-list: anything that is not one of
-- the six the demo walks through goes, so a row nobody remembered creating
-- (SN-2026-500018 was one) cannot survive by being forgotten.
--
-- Children first and explicitly, though `assessments`, `drugs` and `reactions`
-- all cascade from `cases` — whether D1 has foreign_keys on is a property of
-- the connection, not of this file, and orphaned rows are the failure that
-- would show up later as a case screen that 500s.
--
-- `claims` is deleted here because it has NO foreign key: `case_id` is its
-- primary key and nothing cascades to it. A claim on a deleted case is
-- invisible rather than wrong, which is why it has to be named.
--
-- `audit_log` IS DELIBERATELY UNTOUCHED. It is the durable record of every
-- mutation, per non-negotiable #9, and lines about cases that no longer exist
-- are exactly what an audit trail is for. Deleting them to tidy the demo would
-- be editing the evidence.

DELETE FROM assessments WHERE case_id NOT IN (
  '00000002-0000-4000-8000-000000000101',
  '00000002-0000-4000-8000-000000000102',
  '00000002-0000-4000-8000-000000000105',
  'd767e7a2-a4e7-453b-9b33-5bff6d0374ea',
  'c72a4ebe-e19a-44cc-9b97-8bae1886d0ec',
  '9d8009a9-7e7c-4651-9a5b-bd5f90c652ba'
);

DELETE FROM drugs WHERE case_id NOT IN (
  '00000002-0000-4000-8000-000000000101',
  '00000002-0000-4000-8000-000000000102',
  '00000002-0000-4000-8000-000000000105',
  'd767e7a2-a4e7-453b-9b33-5bff6d0374ea',
  'c72a4ebe-e19a-44cc-9b97-8bae1886d0ec',
  '9d8009a9-7e7c-4651-9a5b-bd5f90c652ba'
);

DELETE FROM reactions WHERE case_id NOT IN (
  '00000002-0000-4000-8000-000000000101',
  '00000002-0000-4000-8000-000000000102',
  '00000002-0000-4000-8000-000000000105',
  'd767e7a2-a4e7-453b-9b33-5bff6d0374ea',
  'c72a4ebe-e19a-44cc-9b97-8bae1886d0ec',
  '9d8009a9-7e7c-4651-9a5b-bd5f90c652ba'
);

DELETE FROM claims WHERE case_id NOT IN (
  '00000002-0000-4000-8000-000000000101',
  '00000002-0000-4000-8000-000000000102',
  '00000002-0000-4000-8000-000000000105',
  'd767e7a2-a4e7-453b-9b33-5bff6d0374ea',
  'c72a4ebe-e19a-44cc-9b97-8bae1886d0ec',
  '9d8009a9-7e7c-4651-9a5b-bd5f90c652ba'
);

DELETE FROM cases WHERE id NOT IN (
  '00000002-0000-4000-8000-000000000101',
  '00000002-0000-4000-8000-000000000102',
  '00000002-0000-4000-8000-000000000105',
  'd767e7a2-a4e7-453b-9b33-5bff6d0374ea',
  'c72a4ebe-e19a-44cc-9b97-8bae1886d0ec',
  '9d8009a9-7e7c-4651-9a5b-bd5f90c652ba'
);
