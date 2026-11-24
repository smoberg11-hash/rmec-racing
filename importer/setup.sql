-- One-time setup for the Python importer. Run in the Supabase SQL Editor.
-- Run STEP 1 first and look at the output. Only run STEP 2 when STEP 1 returns no rows.

-- STEP 1: look for duplicates that would block the unique constraints.
select 'duplicate rider livelaps_id' as problem, livelaps_id::text as value, count(*)
from riders group by livelaps_id having count(*) > 1
union all
select 'duplicate results livelaps_result_id', livelaps_result_id::text, count(*)
from results where livelaps_result_id is not null
group by livelaps_result_id having count(*) > 1;

-- STEP 2: constraints the importer relies on.
-- One rider per LiveLaps user, so riders can be added/updated in one request.
alter table riders add constraint riders_livelaps_id_key unique (livelaps_id);
-- One result per LiveLaps result, so re-running an import never creates duplicates.
-- (Skip this line if it says the constraint already exists.)
alter table results add constraint results_livelaps_result_id_key unique (livelaps_result_id);
-- New riders created by the importer start as non-members.
alter table riders alter column is_member set default false;
