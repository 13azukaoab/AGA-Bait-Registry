-- month_closures, monthly_branch_snapshots (Task 7 + v1.2/v1.4/v1.5 changes)
BEGIN;
SELECT plan(47);

SELECT has_table('public', 'month_closures', 'month_closures exists');
SELECT has_table('public', 'monthly_branch_snapshots', 'monthly_branch_snapshots exists');

-- ---------- month_closures (v1.2 + v1.5) ----------
SELECT col_is_pk('public', 'month_closures', ARRAY['month_key', 'scope'], 'month_closures PK is (month_key, scope)');
SELECT col_type_is('public', 'month_closures', 'month_key', 'text', 'month_key is text');
SELECT col_type_is('public', 'month_closures', 'scope', 'public', 'closure_scope', 'scope uses closure_scope enum');
SELECT col_not_null('public', 'month_closures', 'scope', 'scope NOT NULL');
SELECT enum_has_labels('public', 'closure_scope', ARRAY['central', 'provincial'], 'closure_scope = central / provincial');
SELECT col_type_is('public', 'month_closures', 'closed_at', 'timestamp with time zone', 'closed_at timestamptz');
SELECT col_type_is('public', 'month_closures', 'closed_by', 'uuid', 'closed_by uuid');
SELECT col_type_is('public', 'month_closures', 'last_resync_at', 'timestamp with time zone', 'last_resync_at timestamptz');
SELECT col_type_is('public', 'month_closures', 'last_resync_by', 'uuid', 'last_resync_by uuid');
SELECT fk_ok('public', 'month_closures', 'last_resync_by', 'auth', 'users', 'id', 'last_resync_by -> auth.users');
SELECT hasnt_column('public', 'month_closures', 'reopened_at', 'reopened_at dropped (v1.2: no reopen step)');
SELECT hasnt_column('public', 'month_closures', 'reopened_by', 'reopened_by dropped (v1.2: no reopen step)');

-- ---------- monthly_branch_snapshots ----------
SELECT col_is_pk('public', 'monthly_branch_snapshots', ARRAY['month_key', 'branch_id'], 'snapshot PK is (month_key, branch_id)');
SELECT fk_ok('public', 'monthly_branch_snapshots', 'branch_id', 'public', 'branches', 'id', 'branch_id -> branches');
SELECT col_type_is('public', 'monthly_branch_snapshots', 'source', 'public', 'snapshot_source', 'source uses snapshot_source enum');

-- Dashboard fields: 8 tier counts + cust are int
SELECT col_type_is('public', 'monthly_branch_snapshots', c, 'integer', c || ' is integer')
FROM unnest(ARRAY['s1','s3','m1','m3','l1','l3','xl1','xl3','cust']) c;

-- value fields numeric(14,2)
SELECT col_type_is('public', 'monthly_branch_snapshots', c, 'numeric(14,2)', c || ' is numeric(14,2)')
FROM unnest(ARRAY['vS','vM','vL','vXL','value','value_annual']) c;

-- v1.4: value per tier (8) - NOT NULL default 0
SELECT col_type_is('public', 'monthly_branch_snapshots', c, 'numeric(14,2)', c || ' is numeric(14,2)')
FROM unnest(ARRAY['v_s1','v_s3','v_m1','v_m3','v_l1','v_l3','v_xl1','v_xl3']) c;

-- v1.4: totals from the branch report (nullable = not compared yet) + confirmation
SELECT col_type_is('public', 'monthly_branch_snapshots', 'report_cust', 'integer', 'report_cust is integer');
SELECT col_type_is('public', 'monthly_branch_snapshots', 'report_value', 'numeric(14,2)', 'report_value is numeric(14,2)');
SELECT col_is_null('public', 'monthly_branch_snapshots', 'report_cust', 'report_cust nullable');
SELECT col_is_null('public', 'monthly_branch_snapshots', 'report_value', 'report_value nullable');
SELECT col_type_is('public', 'monthly_branch_snapshots', 'confirmed_at', 'timestamp with time zone', 'confirmed_at timestamptz');
SELECT col_type_is('public', 'monthly_branch_snapshots', 'confirmed_by', 'uuid', 'confirmed_by uuid');
SELECT fk_ok('public', 'monthly_branch_snapshots', 'confirmed_by', 'auth', 'users', 'id', 'confirmed_by -> auth.users');

SELECT * FROM finish();
ROLLBACK;
