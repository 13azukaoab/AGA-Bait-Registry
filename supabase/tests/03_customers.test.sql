-- customers table (Task 4)
BEGIN;
SELECT plan(16);

SELECT has_table('public', 'customers', 'customers exists');
SELECT col_is_pk('public', 'customers', 'id', 'id is PK');
SELECT col_type_is('public', 'customers', 'id', 'uuid', 'id uuid');
SELECT col_has_default('public', 'customers', 'id', 'id has default');
SELECT col_type_is('public', 'customers', 'branch_id', 'uuid', 'branch_id uuid');
SELECT col_not_null('public', 'customers', 'branch_id', 'branch_id NOT NULL');
SELECT col_type_is('public', 'customers', 'name', 'text', 'name text');
SELECT col_not_null('public', 'customers', 'name', 'name NOT NULL');
SELECT col_type_is('public', 'customers', 'address', 'text', 'address text');
SELECT col_type_is('public', 'customers', 'phone', 'text', 'phone text');
SELECT col_type_is('public', 'customers', 'contact_name', 'text', 'contact_name text');
SELECT col_type_is('public', 'customers', 'customer_type', 'text', 'customer_type text');
SELECT col_type_is('public', 'customers', 'created_at', 'timestamp with time zone', 'created_at timestamptz');
SELECT col_type_is('public', 'customers', 'updated_at', 'timestamp with time zone', 'updated_at timestamptz');
SELECT fk_ok('public', 'customers', 'branch_id', 'public', 'branches', 'id', 'branch_id -> branches');
SELECT fk_ok('public', 'customers', 'customer_type', 'public', 'customer_types', 'code', 'customer_type -> customer_types');

SELECT * FROM finish();
ROLLBACK;
