-- 棚卸し・在庫管理 Phase 1
-- 店舗境界、棚卸し正本、監査履歴、POS再集計snapshot、現在庫投影を定義する。
-- このmigrationでは既存データの投入や店舗権限の自動付与は行わない。

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- JWTのuser metadataや画面Cookieではなく、DB上の明示的な対応表を店舗権限の正本にする。
CREATE TABLE public.user_store_access (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, store_id),
    CHECK (store_id IN (6, 7)),
    CHECK (role IN ('manager', 'staff', 'viewer'))
);

CREATE OR REPLACE FUNCTION private.can_access_store(
    p_store_id INTEGER,
    p_roles TEXT[] DEFAULT ARRAY['manager', 'staff', 'viewer']::TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_store_access AS access_row
        WHERE access_row.user_id = (SELECT auth.uid())
          AND access_row.store_id = p_store_id
          AND access_row.role = ANY (p_roles)
    );
$$;

REVOKE ALL ON FUNCTION private.can_access_store(INTEGER, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_store(INTEGER, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION private.can_access_store(INTEGER, TEXT[]) TO authenticated, service_role;

-- product_idだけでなくstore_id + JANまで同じ商品行を指すための参照キー。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_id_store_id_jan_code_key'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_id_store_id_jan_code_key
            UNIQUE (id, store_id, jan_code);

        COMMENT ON CONSTRAINT products_id_store_id_jan_code_key ON public.products IS
            'inventory_management_phase1';
    END IF;
END $$;

CREATE TABLE public.inventory_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft',
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    started_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    finalized_at TIMESTAMPTZ,
    finalized_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    row_version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (id, store_id),
    CHECK (store_id IN (6, 7)),
    CHECK (status IN ('draft', 'finalizing', 'finalized', 'cancelled')),
    CHECK (row_version >= 1),
    CHECK (
        (status IN ('draft', 'finalizing') AND finalized_at IS NULL AND finalized_by IS NULL)
        OR (status = 'finalized' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
        OR (status = 'cancelled' AND finalized_at IS NULL AND finalized_by IS NULL)
    )
);

CREATE UNIQUE INDEX inventory_sessions_one_active_per_store_idx
    ON public.inventory_sessions (store_id)
    WHERE status IN ('draft', 'finalizing');

CREATE TABLE public.inventory_session_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    jan_snapshot TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    category_snapshot TEXT,
    supplier_snapshot TEXT,
    shelf_snapshot TEXT,
    counted_quantity NUMERIC(14, 3),
    counted_at TIMESTAMPTZ,
    counted_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    excluded_at TIMESTAMPTZ,
    excluded_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    exclusion_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    row_version BIGINT NOT NULL DEFAULT 1,
    UNIQUE (id, store_id),
    UNIQUE (id, session_id, store_id, product_id),
    UNIQUE (session_id, product_id),
    UNIQUE (session_id, store_id, jan_snapshot),
    FOREIGN KEY (session_id, store_id)
        REFERENCES public.inventory_sessions (id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, store_id, jan_snapshot)
        REFERENCES public.products (id, store_id, jan_code) ON DELETE RESTRICT,
    CHECK (store_id IN (6, 7)),
    CHECK (BTRIM(jan_snapshot) <> ''),
    CHECK (BTRIM(product_name_snapshot) <> ''),
    CHECK (row_version >= 1),
    CHECK (
        (counted_quantity IS NULL AND counted_at IS NULL AND counted_by IS NULL)
        OR (
            counted_quantity IS NOT NULL
            AND counted_quantity >= 0
            AND counted_at IS NOT NULL
            AND counted_by IS NOT NULL
        )
    ),
    CHECK (
        (excluded_at IS NULL AND excluded_by IS NULL AND exclusion_reason IS NULL)
        OR (
            excluded_at IS NOT NULL
            AND excluded_by IS NOT NULL
            AND exclusion_reason IS NOT NULL
            AND BTRIM(exclusion_reason) <> ''
            AND counted_quantity IS NULL
            AND counted_at IS NULL
            AND counted_by IS NULL
        )
    )
);

-- 数量入力は営業中を前提とし、各商品の計数時刻と変更前後を追記で残す。
CREATE TABLE public.inventory_count_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL,
    session_id UUID NOT NULL,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    change_kind TEXT NOT NULL,
    previous_quantity NUMERIC(14, 3),
    new_quantity NUMERIC(14, 3),
    previous_counted_at TIMESTAMPTZ,
    new_counted_at TIMESTAMPTZ,
    reason TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, session_id, store_id, product_id)
        REFERENCES public.inventory_session_items (id, session_id, store_id, product_id)
        ON DELETE RESTRICT,
    CHECK (store_id IN (6, 7)),
    CHECK (
        change_kind IN (
            'initial_count',
            'add',
            'replace',
            'confirm',
            'post_finalize_correction',
            'exclude',
            'restore'
        )
    ),
    CHECK (previous_quantity IS NULL OR previous_quantity >= 0),
    CHECK (new_quantity IS NULL OR new_quantity >= 0),
    CHECK (previous_counted_at IS NULL OR previous_quantity IS NOT NULL),
    CHECK (new_counted_at IS NULL OR new_quantity IS NOT NULL),
    CHECK (
        change_kind NOT IN ('post_finalize_correction', 'exclude', 'restore')
        OR (reason IS NOT NULL AND BTRIM(reason) <> '')
    )
);

CREATE INDEX inventory_count_changes_item_time_idx
    ON public.inventory_count_changes (item_id, changed_at);

CREATE INDEX inventory_count_changes_store_product_time_idx
    ON public.inventory_count_changes (store_id, product_id, changed_at);

-- 確定後の増減は正本を書き換えず、理由付きの差分として追記する。
CREATE TABLE public.inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity_delta NUMERIC(14, 3) NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    reverses_adjustment_id UUID,
    idempotency_key UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    UNIQUE (id, store_id),
    UNIQUE (store_id, idempotency_key),
    FOREIGN KEY (product_id, store_id)
        REFERENCES public.products (id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (reverses_adjustment_id, store_id)
        REFERENCES public.inventory_adjustments (id, store_id) ON DELETE RESTRICT,
    CHECK (store_id IN (6, 7)),
    CHECK (quantity_delta <> 0),
    CHECK (BTRIM(reason) <> ''),
    CHECK (reverses_adjustment_id IS NULL OR reverses_adjustment_id <> id)
);

CREATE INDEX inventory_adjustments_store_product_time_idx
    ON public.inventory_adjustments (store_id, product_id, effective_at);

CREATE TABLE public.inventory_product_settings (
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    shelf_code TEXT,
    display_order INTEGER,
    variance_threshold NUMERIC(14, 3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    row_version BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (store_id, product_id),
    FOREIGN KEY (product_id, store_id)
        REFERENCES public.products (id, store_id) ON DELETE CASCADE,
    CHECK (store_id IN (6, 7)),
    CHECK (display_order IS NULL OR display_order >= 0),
    CHECK (variance_threshold >= 0),
    CHECK (row_version >= 1)
);

-- POS履歴は取得単位のimmutable snapshotとして保存し、毎回同じ範囲を再集計できるようにする。
CREATE TABLE public.pos_inventory_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
    source_from TIMESTAMPTZ NOT NULL,
    source_to TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    fetched_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    payload_sha256 TEXT NOT NULL,
    failure_message TEXT,
    UNIQUE (id, store_id),
    CHECK (store_id IN (6, 7)),
    CHECK (source_to >= source_from),
    CHECK (status IN ('succeeded', 'failed')),
    CHECK (row_count >= 0),
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (
        (status = 'succeeded' AND failure_message IS NULL)
        OR (status = 'failed' AND failure_message IS NOT NULL AND BTRIM(failure_message) <> '')
    )
);

CREATE INDEX pos_inventory_snapshots_store_period_idx
    ON public.pos_inventory_snapshots (store_id, source_from, source_to, fetched_at DESC);

CREATE TABLE public.pos_inventory_snapshot_rows (
    snapshot_id UUID NOT NULL,
    row_no INTEGER NOT NULL,
    store_id INTEGER NOT NULL,
    source_event_id TEXT,
    signature_hash TEXT NOT NULL,
    signature_ordinal INTEGER NOT NULL DEFAULT 1,
    event_kind TEXT NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    event_time_precision TEXT NOT NULL DEFAULT 'minute',
    jan_code TEXT,
    product_code TEXT,
    product_name TEXT NOT NULL,
    quantity NUMERIC(14, 3) NOT NULL,
    unit_price NUMERIC(14, 2),
    total_amount NUMERIC(14, 2),
    match_status TEXT NOT NULL,
    matched_product_id INTEGER,
    raw_payload JSONB NOT NULL,
    PRIMARY KEY (snapshot_id, row_no),
    UNIQUE (snapshot_id, signature_hash, signature_ordinal),
    FOREIGN KEY (snapshot_id, store_id)
        REFERENCES public.pos_inventory_snapshots (id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (matched_product_id, store_id)
        REFERENCES public.products (id, store_id) ON DELETE RESTRICT,
    CHECK (row_no >= 1),
    CHECK (store_id IN (6, 7)),
    CHECK (signature_ordinal >= 1),
    CHECK (signature_hash ~ '^[0-9a-f]{64}$'),
    CHECK (event_kind IN ('sale', 'return', 'order', 'adjustment', 'unknown')),
    CHECK (event_time_precision IN ('minute', 'second', 'unknown')),
    CHECK (quantity >= 0),
    CHECK (BTRIM(product_name) <> ''),
    CHECK (
        match_status IN (
            'matched',
            'missing_jan',
            'unknown_product',
            'ambiguous_jan',
            'ignored_kind'
        )
    ),
    CHECK (
        (match_status = 'matched' AND matched_product_id IS NOT NULL)
        OR (match_status <> 'matched' AND matched_product_id IS NULL)
    )
);

CREATE UNIQUE INDEX pos_inventory_snapshot_rows_source_event_idx
    ON public.pos_inventory_snapshot_rows (snapshot_id, source_event_id)
    WHERE source_event_id IS NOT NULL;

CREATE INDEX pos_inventory_snapshot_rows_store_event_idx
    ON public.pos_inventory_snapshot_rows (store_id, event_at, event_kind);

CREATE INDEX pos_inventory_snapshot_rows_product_event_idx
    ON public.pos_inventory_snapshot_rows (store_id, matched_product_id, event_at)
    WHERE matched_product_id IS NOT NULL;

-- snapshotと入力時刻を固定した再計算run。fingerprintにより同じ入力の二重計算を識別する。
CREATE TABLE public.inventory_calculation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    snapshot_id UUID NOT NULL,
    store_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    calculation_from TIMESTAMPTZ NOT NULL,
    calculated_as_of TIMESTAMPTZ NOT NULL,
    source_fingerprint TEXT NOT NULL,
    matched_row_count INTEGER NOT NULL DEFAULT 0,
    unmatched_row_count INTEGER NOT NULL DEFAULT 0,
    ambiguous_row_count INTEGER NOT NULL DEFAULT 0,
    duplicate_row_count INTEGER NOT NULL DEFAULT 0,
    result_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    completed_at TIMESTAMPTZ,
    UNIQUE (id, store_id),
    UNIQUE (session_id, snapshot_id, source_fingerprint),
    FOREIGN KEY (session_id, store_id)
        REFERENCES public.inventory_sessions (id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (snapshot_id, store_id)
        REFERENCES public.pos_inventory_snapshots (id, store_id) ON DELETE RESTRICT,
    CHECK (store_id IN (6, 7)),
    CHECK (status IN ('succeeded', 'failed')),
    CHECK (calculated_as_of >= calculation_from),
    CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
    CHECK (matched_row_count >= 0),
    CHECK (unmatched_row_count >= 0),
    CHECK (ambiguous_row_count >= 0),
    CHECK (duplicate_row_count >= 0),
    CHECK (
        (status = 'succeeded' AND error_message IS NULL AND completed_at IS NOT NULL)
        OR (
            status = 'failed'
            AND error_message IS NOT NULL
            AND BTRIM(error_message) <> ''
            AND completed_at IS NOT NULL
        )
    )
);

CREATE INDEX inventory_calculation_runs_store_time_idx
    ON public.inventory_calculation_runs (store_id, calculated_as_of DESC);

-- 上書き可能なのは再計算結果の投影だけ。棚卸し入力と各履歴は上書きしない。
CREATE TABLE public.inventory_balances (
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    session_id UUID NOT NULL,
    session_item_id UUID NOT NULL,
    calculation_run_id UUID NOT NULL,
    physical_quantity NUMERIC(14, 3) NOT NULL,
    counted_at TIMESTAMPTZ NOT NULL,
    sales_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0,
    return_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0,
    transfer_in_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0,
    transfer_out_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0,
    usage_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0,
    adjustment_delta NUMERIC(14, 3) NOT NULL DEFAULT 0,
    calculated_quantity NUMERIC(14, 3) NOT NULL,
    calculated_as_of TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    row_version BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (store_id, product_id),
    FOREIGN KEY (product_id, store_id)
        REFERENCES public.products (id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (session_id, store_id)
        REFERENCES public.inventory_sessions (id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (session_item_id, session_id, store_id, product_id)
        REFERENCES public.inventory_session_items (id, session_id, store_id, product_id)
        ON DELETE RESTRICT,
    FOREIGN KEY (calculation_run_id, store_id)
        REFERENCES public.inventory_calculation_runs (id, store_id) ON DELETE RESTRICT,
    CHECK (store_id IN (6, 7)),
    CHECK (physical_quantity >= 0),
    CHECK (sales_quantity >= 0),
    CHECK (return_quantity >= 0),
    CHECK (transfer_in_quantity >= 0),
    CHECK (transfer_out_quantity >= 0),
    CHECK (usage_quantity >= 0),
    CHECK (row_version >= 1),
    CHECK (
        calculated_quantity = physical_quantity
            - sales_quantity
            + return_quantity
            + transfer_in_quantity
            - transfer_out_quantity
            - usage_quantity
            + adjustment_delta
    )
);

CREATE INDEX inventory_balances_calculation_run_idx
    ON public.inventory_balances (calculation_run_id);

CREATE OR REPLACE FUNCTION private.bump_inventory_row_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.bump_inventory_row_version() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER bump_inventory_sessions_row_version
    BEFORE UPDATE ON public.inventory_sessions
    FOR EACH ROW EXECUTE FUNCTION private.bump_inventory_row_version();

CREATE TRIGGER bump_inventory_session_items_row_version
    BEFORE UPDATE ON public.inventory_session_items
    FOR EACH ROW EXECUTE FUNCTION private.bump_inventory_row_version();

CREATE TRIGGER bump_inventory_product_settings_row_version
    BEFORE UPDATE ON public.inventory_product_settings
    FOR EACH ROW EXECUTE FUNCTION private.bump_inventory_row_version();

CREATE TRIGGER bump_inventory_balances_row_version
    BEFORE UPDATE ON public.inventory_balances
    FOR EACH ROW EXECUTE FUNCTION private.bump_inventory_row_version();

CREATE OR REPLACE FUNCTION private.prevent_inventory_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_inventory_history_mutation()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prevent_inventory_count_changes_mutation
    BEFORE UPDATE OR DELETE ON public.inventory_count_changes
    FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_inventory_count_changes_truncate
    BEFORE TRUNCATE ON public.inventory_count_changes
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_inventory_adjustments_mutation
    BEFORE UPDATE OR DELETE ON public.inventory_adjustments
    FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_inventory_adjustments_truncate
    BEFORE TRUNCATE ON public.inventory_adjustments
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_pos_inventory_snapshots_mutation
    BEFORE UPDATE OR DELETE ON public.pos_inventory_snapshots
    FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_pos_inventory_snapshots_truncate
    BEFORE TRUNCATE ON public.pos_inventory_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_pos_inventory_snapshot_rows_mutation
    BEFORE UPDATE OR DELETE ON public.pos_inventory_snapshot_rows
    FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_pos_inventory_snapshot_rows_truncate
    BEFORE TRUNCATE ON public.pos_inventory_snapshot_rows
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_inventory_calculation_runs_mutation
    BEFORE UPDATE OR DELETE ON public.inventory_calculation_runs
    FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_inventory_calculation_runs_truncate
    BEFORE TRUNCATE ON public.inventory_calculation_runs
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_inventory_history_mutation();

ALTER TABLE public.user_store_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_store_access FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_session_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_product_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_product_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_inventory_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_inventory_snapshot_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_inventory_snapshot_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_calculation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances FORCE ROW LEVEL SECURITY;

CREATE POLICY user_store_access_select_own
    ON public.user_store_access
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY inventory_sessions_select_store
    ON public.inventory_sessions
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY inventory_session_items_select_store
    ON public.inventory_session_items
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY inventory_count_changes_select_store
    ON public.inventory_count_changes
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY inventory_adjustments_select_store
    ON public.inventory_adjustments
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY inventory_product_settings_select_store
    ON public.inventory_product_settings
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY pos_inventory_snapshots_select_store
    ON public.pos_inventory_snapshots
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY pos_inventory_snapshot_rows_select_store
    ON public.pos_inventory_snapshot_rows
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY inventory_calculation_runs_select_store
    ON public.inventory_calculation_runs
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

CREATE POLICY inventory_balances_select_store
    ON public.inventory_balances
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE
    public.user_store_access,
    public.inventory_sessions,
    public.inventory_session_items,
    public.inventory_count_changes,
    public.inventory_adjustments,
    public.inventory_product_settings,
    public.pos_inventory_snapshots,
    public.pos_inventory_snapshot_rows,
    public.inventory_calculation_runs,
    public.inventory_balances
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
    public.user_store_access,
    public.inventory_sessions,
    public.inventory_session_items,
    public.inventory_count_changes,
    public.inventory_adjustments,
    public.inventory_product_settings,
    public.pos_inventory_snapshots,
    public.pos_inventory_snapshot_rows,
    public.inventory_calculation_runs,
    public.inventory_balances
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.user_store_access
TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE
    public.inventory_sessions,
    public.inventory_session_items,
    public.inventory_product_settings,
    public.inventory_balances
TO service_role;

GRANT SELECT, INSERT ON TABLE
    public.inventory_count_changes,
    public.inventory_adjustments,
    public.pos_inventory_snapshots,
    public.pos_inventory_snapshot_rows,
    public.inventory_calculation_runs
TO service_role;

COMMENT ON TABLE public.inventory_session_items IS
    'counted_quantity NULLは未棚卸し、0は棚卸し済み在庫0を表す。counted_atは営業中の計数基準時刻。';
COMMENT ON TABLE public.pos_inventory_snapshots IS
    '同じ期間を何度同期しても差分減算せず再集計できる、取得結果のimmutable snapshot。';
COMMENT ON TABLE public.inventory_balances IS
    '確定棚卸しを基準に各履歴を再集計した現在庫投影。正本履歴ではない。';
