-- audit_log + audit_trigger (Task 8)
BEGIN;
SELECT plan(19);

SELECT has_table('public', 'audit_log', 'audit_log exists');
SELECT has_function('public', 'audit_trigger', 'audit_trigger() exists');
SELECT col_type_is('public', 'audit_log', 'action', 'public', 'audit_action', 'action uses audit_action enum');
SELECT trigger_is('public', 'customers', 'audit_customers', 'public', 'audit_trigger', 'customers trigger');
SELECT has_trigger('public', 'contracts', 'audit_contracts', 'contracts trigger');
SELECT has_trigger('public', 'contract_teams', 'audit_contract_teams', 'contract_teams trigger');
SELECT has_trigger('public', 'stations', 'audit_stations', 'stations trigger');
SELECT has_trigger('public', 'visits', 'audit_visits', 'visits trigger');
SELECT has_trigger('public', 'station_checks', 'audit_station_checks', 'station_checks trigger');

-- Acting user (auth.uid() reads request.jwt.claim.sub)
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'audit@test.local');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

INSERT INTO public.customers (id, branch_id, name)
VALUES ('00000000-0000-0000-0000-0000000000c1', (SELECT id FROM public.branches ORDER BY name LIMIT 1), 'Audit Co');
UPDATE public.customers SET name = 'Audit Co 2' WHERE id = '00000000-0000-0000-0000-0000000000c1';
DELETE FROM public.customers WHERE id = '00000000-0000-0000-0000-0000000000c1';

SELECT is((SELECT count(*)::int FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1'), 3, '3 audit rows');
SELECT is((SELECT array_agg(action::text ORDER BY changed_at, action) FROM public.audit_log
           WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND table_name = 'customers') @> ARRAY['insert','update','delete'], true, 'actions insert/update/delete present');

SELECT is((SELECT old_data FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND action = 'insert'), NULL::jsonb, 'insert old_data NULL');
SELECT is((SELECT new_data->>'name' FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND action = 'insert'), 'Audit Co', 'insert new_data populated');
SELECT is((SELECT old_data->>'name' FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND action = 'update'), 'Audit Co', 'update old_data');
SELECT is((SELECT new_data->>'name' FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND action = 'update'), 'Audit Co 2', 'update new_data');
SELECT is((SELECT old_data->>'name' FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND action = 'delete'), 'Audit Co 2', 'delete old_data');
SELECT is((SELECT new_data FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND action = 'delete'), NULL::jsonb, 'delete new_data NULL');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND changed_by = '00000000-0000-0000-0000-0000000000a1'), 3, 'changed_by = auth.uid()');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE row_id = '00000000-0000-0000-0000-0000000000c1' AND table_name = 'customers'), 3, 'table_name = customers');

SELECT * FROM finish();
ROLLBACK;
