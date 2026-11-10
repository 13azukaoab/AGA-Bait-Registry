-- month_closures, monthly_branch_snapshots (Task 7)
BEGIN;
SELECT plan(26);

SELECT has_table('public', 'month_closures', 'month_closures exists');
SELECT has_table('public', 'monthly_branch_snapshots', 'monthly_branch_snapshots exists');

SELECT col_is_pk('public', 'month_closures', 'month_key', 'month_closures PK is month_key');
SELECT col_type_is('public', 'month_closures', 'month_key', 'text', 'month_key is text');
SELECT col_type_is('public', 'month_closures', 'closed_at', 'timestamp with time zone', 'closed_at timestamptz');
SELECT col_type_is('public', 'month_closures', 'reopened_at', 'timestamp with time zone', 'reopened_at timestamptz');
SELECT col_type_is('public', 'month_closures', 'closed_by', 'uuid', 'closed_by uuid');
SELECT col_type_is('public', 'month_closures', 'reopened_by', 'uuid', 'reopened_by uuid');

SELECT col_is_pk('public', 'monthly_branch_snapshots', ARRAY['month_key', 'branch_id'], 'snapshot PK is (month_key, branch_id)');
SELECT fk_ok('public', 'monthly_branch_snapshots', 'branch_id', 'public', 'branches', 'id', 'branch_id -> branches');
SELECT col_type_is('public', 'monthly_branch_snapshots', 'source', 'public', 'snapshot_source', 'source uses snapshot_source enum');

-- Dashboard fields: 8 tier counts + cust are int
SELECT col_type_is('public', 'monthly_branch_snapshots', c, 'integer', c || ' is integer')
FROM unnest(ARRAY['s1','s3','m1','m3','l1','l3','xl1','xl3','cust']) c;

-- value fields numeric(14,2)
SELECT col_type_is('public', 'monthly_branch_snapshots', c, 'numeric(14,2)', c || ' is numeric(14,2)')
FROM unnest(ARRAY['vS','vM','vL','vXL','value','value_annual']) c;

SELECT * FROM finish();
ROLLBACK;
