-- 棚卸し・在庫管理 Phase 4
-- 商品の手動停止、確定前preview、理由付き除外/訂正/調整、現在庫、印刷データを追加する。

ALTER TABLE public.inventory_product_settings
    ADD COLUMN manually_inactive BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN status_reason TEXT,
    ADD COLUMN status_changed_at TIMESTAMPTZ,
    ADD COLUMN status_changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_product_settings
    ADD CONSTRAINT inventory_product_settings_manual_status_check
    CHECK (
        (manually_inactive = FALSE)
        OR (
            status_reason IS NOT NULL
            AND BTRIM(status_reason) <> ''
            AND status_changed_at IS NOT NULL
            AND status_changed_by IS NOT NULL
        )
    );

CREATE TABLE public.inventory_product_status_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    jan_snapshot TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    previous_active BOOLEAN NOT NULL,
    new_active BOOLEAN NOT NULL,
    previous_manually_inactive BOOLEAN NOT NULL,
    new_manually_inactive BOOLEAN NOT NULL,
    reason TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, store_id, jan_snapshot)
        REFERENCES public.products (id, store_id, jan_code) ON DELETE RESTRICT,
    CHECK (store_id IN (6, 7)),
    CHECK (BTRIM(jan_snapshot) <> ''),
    CHECK (BTRIM(product_name_snapshot) <> ''),
    CHECK (BTRIM(reason) <> '')
);

CREATE INDEX inventory_product_status_changes_store_product_time_idx
    ON public.inventory_product_status_changes (store_id, product_id, changed_at DESC);

ALTER TABLE public.inventory_product_status_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_product_status_changes FORCE ROW LEVEL SECURITY;

CREATE POLICY inventory_product_status_changes_select_store
    ON public.inventory_product_status_changes
    FOR SELECT
    TO authenticated
    USING ((SELECT private.can_access_store(store_id)));

REVOKE ALL ON TABLE public.inventory_product_status_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_product_status_changes TO authenticated;
GRANT SELECT, INSERT ON TABLE public.inventory_product_status_changes TO service_role;

CREATE TRIGGER prevent_inventory_product_status_changes_mutation
    BEFORE UPDATE OR DELETE ON public.inventory_product_status_changes
    FOR EACH ROW EXECUTE FUNCTION private.prevent_inventory_history_mutation();

CREATE TRIGGER prevent_inventory_product_status_changes_truncate
    BEFORE TRUNCATE ON public.inventory_product_status_changes
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_inventory_history_mutation();

-- GASの商品同期がis_active=trueを送っても、棚卸し側の明示的な停止を解除しない。
CREATE OR REPLACE FUNCTION private.enforce_inventory_manual_inactive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.is_active = TRUE
       AND EXISTS (
           SELECT 1
             FROM public.inventory_product_settings AS settings
            WHERE settings.store_id = NEW.store_id
              AND settings.product_id = NEW.id
              AND settings.manually_inactive = TRUE
       ) THEN
        NEW.is_active := FALSE;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_inventory_manual_inactive() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_inventory_manual_inactive
    BEFORE UPDATE OF is_active ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.enforce_inventory_manual_inactive();

-- 商品行が別端末で変わった場合も、確定時のsession row versionで競合を検出できるようにする。
CREATE OR REPLACE FUNCTION private.touch_inventory_session_from_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.inventory_sessions AS session
       SET updated_by = NEW.updated_by
     WHERE session.id = NEW.session_id
       AND session.store_id = NEW.store_id
       AND session.status = 'draft';
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.touch_inventory_session_from_item_change()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER touch_inventory_session_from_item_change
    AFTER UPDATE OF counted_quantity, counted_at, excluded_at ON public.inventory_session_items
    FOR EACH ROW EXECUTE FUNCTION private.touch_inventory_session_from_item_change();

CREATE OR REPLACE FUNCTION public.set_inventory_product_status(
    p_store_id INTEGER,
    p_jan_code TEXT,
    p_active BOOLEAN,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := (SELECT auth.uid());
    v_product public.products%ROWTYPE;
    v_previous_active BOOLEAN;
    v_previous_manual BOOLEAN := FALSE;
    v_new_active BOOLEAN;
    v_new_manual BOOLEAN := NOT p_active;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager']::TEXT[]) THEN
        RAISE EXCEPTION 'manager store access required' USING ERRCODE = '42501';
    END IF;
    IF p_jan_code IS NULL OR BTRIM(p_jan_code) = '' OR p_active IS NULL THEN
        RAISE EXCEPTION 'store, JAN and status are required' USING ERRCODE = '22023';
    END IF;
    IF p_reason IS NULL OR BTRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'status reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT product.*
      INTO v_product
      FROM public.products AS product
     WHERE product.store_id = p_store_id
       AND product.jan_code = BTRIM(p_jan_code)
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory product not found' USING ERRCODE = '22023';
    END IF;

    v_previous_active := v_product.is_active;
    SELECT settings.manually_inactive
      INTO v_previous_manual
      FROM public.inventory_product_settings AS settings
     WHERE settings.store_id = p_store_id
       AND settings.product_id = v_product.id
     FOR UPDATE;
    v_previous_manual := COALESCE(v_previous_manual, FALSE);

    INSERT INTO public.inventory_product_settings (
        store_id,
        product_id,
        manually_inactive,
        status_reason,
        status_changed_at,
        status_changed_by,
        updated_by
    ) VALUES (
        p_store_id,
        v_product.id,
        v_new_manual,
        CASE WHEN v_new_manual THEN BTRIM(p_reason) ELSE NULL END,
        v_now,
        v_user_id,
        v_user_id
    )
    ON CONFLICT (store_id, product_id) DO UPDATE SET
        manually_inactive = EXCLUDED.manually_inactive,
        status_reason = EXCLUDED.status_reason,
        status_changed_at = EXCLUDED.status_changed_at,
        status_changed_by = EXCLUDED.status_changed_by,
        updated_by = EXCLUDED.updated_by;

    UPDATE public.products AS product
       SET is_active = p_active,
           updated_at = v_now
     WHERE product.id = v_product.id
       AND product.store_id = p_store_id
       AND product.jan_code = BTRIM(p_jan_code)
    RETURNING product.is_active INTO v_new_active;

    IF v_previous_active IS DISTINCT FROM v_new_active
       OR v_previous_manual IS DISTINCT FROM v_new_manual THEN
        INSERT INTO public.inventory_product_status_changes (
            store_id,
            product_id,
            jan_snapshot,
            product_name_snapshot,
            previous_active,
            new_active,
            previous_manually_inactive,
            new_manually_inactive,
            reason,
            changed_by
        ) VALUES (
            p_store_id,
            v_product.id,
            v_product.jan_code,
            COALESCE(NULLIF(BTRIM(v_product.product_name), ''), '商品名未設定'),
            v_previous_active,
            v_new_active,
            v_previous_manual,
            v_new_manual,
            BTRIM(p_reason),
            v_user_id
        );
    END IF;

    RETURN jsonb_build_object(
        'storeId', p_store_id,
        'productId', v_product.id,
        'janCode', v_product.jan_code,
        'productName', v_product.product_name,
        'isActive', v_new_active,
        'manuallyInactive', v_new_manual,
        'changedAt', v_now
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_inventory_item_exclusion(
    p_session_id UUID,
    p_store_id INTEGER,
    p_jan_code TEXT,
    p_excluded BOOLEAN,
    p_reason TEXT,
    p_expected_row_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := (SELECT auth.uid());
    v_item public.inventory_session_items%ROWTYPE;
    v_previous_quantity NUMERIC(14, 3);
    v_previous_counted_at TIMESTAMPTZ;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_total BIGINT;
    v_counted BIGINT;
    v_uncounted BIGINT;
    v_excluded_count BIGINT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR BTRIM(p_reason) = '' OR p_excluded IS NULL THEN
        RAISE EXCEPTION 'exclusion reason and state are required' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
      FROM public.inventory_sessions AS session
     WHERE session.id = p_session_id
       AND session.store_id = p_store_id
       AND session.status = 'draft'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory session is not editable' USING ERRCODE = '22023';
    END IF;

    SELECT item.*
      INTO v_item
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.jan_snapshot = BTRIM(p_jan_code)
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory item not found' USING ERRCODE = '22023';
    END IF;
    IF v_item.row_version <> p_expected_row_version THEN
        RAISE EXCEPTION 'inventory item was updated by another user' USING ERRCODE = '40001';
    END IF;

    v_previous_quantity := v_item.counted_quantity;
    v_previous_counted_at := v_item.counted_at;
    IF p_excluded THEN
        UPDATE public.inventory_session_items AS item
           SET counted_quantity = NULL,
               counted_at = NULL,
               counted_by = NULL,
               excluded_at = v_now,
               excluded_by = v_user_id,
               exclusion_reason = BTRIM(p_reason),
               updated_by = v_user_id
         WHERE item.id = v_item.id
           AND item.row_version = p_expected_row_version
        RETURNING item.* INTO v_item;
    ELSE
        UPDATE public.inventory_session_items AS item
           SET excluded_at = NULL,
               excluded_by = NULL,
               exclusion_reason = NULL,
               updated_by = v_user_id
         WHERE item.id = v_item.id
           AND item.row_version = p_expected_row_version
        RETURNING item.* INTO v_item;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory item was updated by another user' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.inventory_count_changes (
        item_id, session_id, store_id, product_id, change_kind,
        previous_quantity, new_quantity, previous_counted_at, new_counted_at,
        reason, changed_by
    ) VALUES (
        v_item.id, p_session_id, p_store_id, v_item.product_id,
        CASE WHEN p_excluded THEN 'exclude' ELSE 'restore' END,
        v_previous_quantity, v_item.counted_quantity,
        v_previous_counted_at, v_item.counted_at,
        BTRIM(p_reason), v_user_id
    );

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE item.counted_quantity IS NOT NULL),
        COUNT(*) FILTER (WHERE item.counted_quantity IS NULL AND item.excluded_at IS NULL),
        COUNT(*) FILTER (WHERE item.excluded_at IS NOT NULL)
      INTO v_total, v_counted, v_uncounted, v_excluded_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id;

    RETURN jsonb_build_object(
        'item', jsonb_build_object(
            'id', v_item.id,
            'sessionId', v_item.session_id,
            'storeId', v_item.store_id,
            'productId', v_item.product_id,
            'janSnapshot', v_item.jan_snapshot,
            'productNameSnapshot', v_item.product_name_snapshot,
            'categorySnapshot', v_item.category_snapshot,
            'supplierSnapshot', v_item.supplier_snapshot,
            'shelfSnapshot', v_item.shelf_snapshot,
            'countedQuantity', v_item.counted_quantity,
            'countedAt', v_item.counted_at,
            'excludedAt', v_item.excluded_at,
            'exclusionReason', v_item.exclusion_reason,
            'rowVersion', v_item.row_version,
            'isActive', (SELECT product.is_active FROM public.products AS product
                         WHERE product.id = v_item.product_id AND product.store_id = p_store_id)
        ),
        'progress', jsonb_build_object(
            'totalCount', v_total,
            'countedCount', v_counted,
            'uncountedCount', v_uncounted,
            'excludedCount', v_excluded_count,
            'progressRate', CASE WHEN v_total = 0 THEN 0
                ELSE ROUND(((v_counted + v_excluded_count)::NUMERIC / v_total::NUMERIC) * 100, 1) END
        )
    );
END;
$$;

-- 確定前確認はinventory_balancesを変更せず、固定snapshotに対する問題と計算結果だけを返す。
CREATE OR REPLACE FUNCTION public.preview_inventory_finalization(
    p_session_id UUID,
    p_store_id INTEGER,
    p_snapshot_id UUID,
    p_calculated_as_of TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_calculation_from TIMESTAMPTZ;
    v_snapshot_to TIMESTAMPTZ;
    v_pending_count BIGINT;
    v_unmatched_count BIGINT;
    v_ambiguous_count BIGINT;
    v_duplicate_count BIGINT;
    v_negative_count BIGINT;
    v_large_adjustment_count BIGINT;
    v_balance_count BIGINT;
    v_issues JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.inventory_sessions AS session
         WHERE session.id = p_session_id AND session.store_id = p_store_id AND session.status = 'draft'
    ) THEN
        RAISE EXCEPTION 'inventory session cannot be previewed' USING ERRCODE = '22023';
    END IF;

    SELECT snapshot.source_to
      INTO v_snapshot_to
      FROM public.pos_inventory_snapshots AS snapshot
     WHERE snapshot.id = p_snapshot_id
       AND snapshot.store_id = p_store_id
       AND snapshot.status = 'succeeded';
    IF NOT FOUND OR v_snapshot_to <> p_calculated_as_of THEN
        RAISE EXCEPTION 'POS snapshot does not match preview time' USING ERRCODE = '22023';
    END IF;

    SELECT
        MIN(item.counted_at) FILTER (WHERE item.counted_at IS NOT NULL AND item.excluded_at IS NULL),
        COUNT(*) FILTER (WHERE item.counted_at IS NULL AND item.excluded_at IS NULL)
      INTO v_calculation_from, v_pending_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id AND item.store_id = p_store_id;
    IF v_calculation_from IS NULL THEN
        RAISE EXCEPTION 'no counted inventory items' USING ERRCODE = '22023';
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE pos.match_status NOT IN ('matched', 'ignored_kind')),
        COUNT(*) FILTER (WHERE pos.signature_ordinal > 1)
      INTO v_unmatched_count, v_duplicate_count
      FROM public.pos_inventory_snapshot_rows AS pos
     WHERE pos.snapshot_id = p_snapshot_id
       AND pos.store_id = p_store_id
       AND pos.event_at > v_calculation_from
       AND pos.event_at <= p_calculated_as_of;

    SELECT COUNT(*)
      INTO v_ambiguous_count
      FROM public.pos_inventory_snapshot_rows AS pos
      JOIN public.inventory_session_items AS item
        ON item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.product_id = pos.matched_product_id
       AND item.counted_at IS NOT NULL
       AND item.excluded_at IS NULL
     WHERE pos.snapshot_id = p_snapshot_id
       AND pos.store_id = p_store_id
       AND pos.match_status = 'matched'
       AND pos.event_at <= p_calculated_as_of
       AND date_trunc('minute', pos.event_at) = date_trunc('minute', item.counted_at);

    WITH preview_rows AS (
        SELECT
            item.product_id,
            item.counted_quantity
                - COALESCE(pos.sales_quantity, 0::NUMERIC)
                + COALESCE(pos.return_quantity, 0::NUMERIC)
                + COALESCE(movement.transfer_in_quantity, 0::NUMERIC)
                - COALESCE(movement.transfer_out_quantity, 0::NUMERIC)
                - COALESCE(movement.usage_quantity, 0::NUMERIC)
                + COALESCE(adjustment.adjustment_delta, 0::NUMERIC) AS calculated_quantity,
            COALESCE(adjustment.adjustment_delta, 0::NUMERIC) AS adjustment_delta,
            COALESCE(settings.variance_threshold, 0::NUMERIC) AS variance_threshold
        FROM public.inventory_session_items AS item
        LEFT JOIN public.inventory_product_settings AS settings
          ON settings.store_id = item.store_id AND settings.product_id = item.product_id
        LEFT JOIN LATERAL (
            SELECT
                COALESCE(SUM(pos.quantity) FILTER (WHERE pos.event_kind = 'sale'), 0::NUMERIC) AS sales_quantity,
                COALESCE(SUM(pos.quantity) FILTER (WHERE pos.event_kind = 'return'), 0::NUMERIC) AS return_quantity
            FROM public.pos_inventory_snapshot_rows AS pos
            WHERE pos.snapshot_id = p_snapshot_id
              AND pos.store_id = p_store_id
              AND pos.matched_product_id = item.product_id
              AND pos.match_status = 'matched'
              AND pos.event_at > item.counted_at
              AND pos.event_at <= p_calculated_as_of
              AND date_trunc('minute', pos.event_at) <> date_trunc('minute', item.counted_at)
        ) AS pos ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                COALESCE(SUM(ABS(transfer.quantity)) FILTER (
                    WHERE transfer.entry_type = 'transfer' AND transfer.to_store_id = p_store_id
                ), 0::NUMERIC) AS transfer_in_quantity,
                COALESCE(SUM(ABS(transfer.quantity)) FILTER (
                    WHERE transfer.entry_type = 'transfer' AND transfer.from_store_id = p_store_id
                ), 0::NUMERIC) AS transfer_out_quantity,
                COALESCE(SUM(ABS(transfer.quantity)) FILTER (
                    WHERE transfer.entry_type = 'usage' AND transfer.from_store_id = p_store_id
                ), 0::NUMERIC) AS usage_quantity
            FROM public.transfers AS transfer
            WHERE transfer.jan_code = item.jan_snapshot
              AND (transfer.from_store_id = p_store_id OR transfer.to_store_id = p_store_id)
              AND transfer.transfer_date > item.counted_at
              AND transfer.transfer_date <= p_calculated_as_of
        ) AS movement ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(adjustment.quantity_delta), 0::NUMERIC) AS adjustment_delta
              FROM public.inventory_adjustments AS adjustment
             WHERE adjustment.store_id = p_store_id
               AND adjustment.product_id = item.product_id
               AND adjustment.effective_at > item.counted_at
               AND adjustment.effective_at <= p_calculated_as_of
        ) AS adjustment ON TRUE
        WHERE item.session_id = p_session_id
          AND item.store_id = p_store_id
          AND item.counted_at IS NOT NULL
          AND item.excluded_at IS NULL
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE calculated_quantity < 0),
        COUNT(*) FILTER (
            WHERE variance_threshold > 0 AND ABS(adjustment_delta) > variance_threshold
        )
      INTO v_balance_count, v_negative_count, v_large_adjustment_count
      FROM preview_rows;

    WITH issues AS (
        SELECT
            CASE WHEN pos.match_status = 'matched' THEN 'same_minute' ELSE 'unmatched' END AS issue_kind,
            pos.row_no,
            pos.jan_code,
            pos.product_name,
            pos.event_kind,
            pos.event_at,
            pos.quantity,
            pos.match_status
        FROM public.pos_inventory_snapshot_rows AS pos
        LEFT JOIN public.inventory_session_items AS item
          ON item.session_id = p_session_id
         AND item.store_id = p_store_id
         AND item.product_id = pos.matched_product_id
         AND item.counted_at IS NOT NULL
         AND item.excluded_at IS NULL
        WHERE pos.snapshot_id = p_snapshot_id
          AND pos.store_id = p_store_id
          AND pos.event_at > v_calculation_from
          AND pos.event_at <= p_calculated_as_of
          AND (
              pos.match_status NOT IN ('matched', 'ignored_kind')
              OR (
                  pos.match_status = 'matched'
                  AND date_trunc('minute', pos.event_at) = date_trunc('minute', item.counted_at)
              )
          )
        ORDER BY pos.event_at, pos.row_no
        LIMIT 100
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'kind', issue_kind,
        'rowNo', row_no,
        'janCode', jan_code,
        'productName', product_name,
        'eventKind', event_kind,
        'eventAt', event_at,
        'quantity', quantity,
        'matchStatus', match_status
    )), '[]'::JSONB) INTO v_issues FROM issues;

    RETURN jsonb_build_object(
        'snapshotId', p_snapshot_id,
        'calculatedAsOf', p_calculated_as_of,
        'pendingCount', v_pending_count,
        'unmatchedCount', v_unmatched_count,
        'ambiguousCount', v_ambiguous_count,
        'duplicateCount', v_duplicate_count,
        'negativeCount', v_negative_count,
        'largeAdjustmentCount', v_large_adjustment_count,
        'balanceCount', v_balance_count,
        'canFinalize', v_pending_count = 0 AND v_unmatched_count = 0 AND v_ambiguous_count = 0,
        'issues', v_issues
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_finalized_inventory_count(
    p_session_id UUID,
    p_store_id INTEGER,
    p_jan_code TEXT,
    p_quantity NUMERIC,
    p_reason TEXT,
    p_expected_row_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := (SELECT auth.uid());
    v_item public.inventory_session_items%ROWTYPE;
    v_previous_quantity NUMERIC(14, 3);
    v_previous_counted_at TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager']::TEXT[]) THEN
        RAISE EXCEPTION 'manager store access required' USING ERRCODE = '42501';
    END IF;
    IF p_quantity IS NULL OR p_quantity < 0 OR p_quantity > 99999999999.999
       OR p_reason IS NULL OR BTRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'valid quantity and correction reason are required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.inventory_sessions AS session
         WHERE session.id = p_session_id AND session.store_id = p_store_id AND session.status = 'finalized'
    ) THEN
        RAISE EXCEPTION 'finalized inventory session not found' USING ERRCODE = '22023';
    END IF;

    SELECT item.* INTO v_item
      FROM public.inventory_session_items AS item
      JOIN public.products AS product
        ON product.id = item.product_id
       AND product.store_id = item.store_id
       AND product.jan_code = item.jan_snapshot
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND product.store_id = p_store_id
       AND product.jan_code = BTRIM(p_jan_code)
       AND item.excluded_at IS NULL
     FOR UPDATE OF item;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found' USING ERRCODE = '22023'; END IF;
    IF v_item.row_version <> p_expected_row_version THEN
        RAISE EXCEPTION 'inventory item was updated by another user' USING ERRCODE = '40001';
    END IF;

    v_previous_quantity := v_item.counted_quantity;
    v_previous_counted_at := v_item.counted_at;
    UPDATE public.inventory_session_items AS item
       SET counted_quantity = p_quantity,
           counted_by = v_user_id,
           updated_by = v_user_id
     WHERE item.id = v_item.id AND item.row_version = p_expected_row_version
    RETURNING item.* INTO v_item;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory item was updated by another user' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.inventory_count_changes (
        item_id, session_id, store_id, product_id, change_kind,
        previous_quantity, new_quantity, previous_counted_at, new_counted_at,
        reason, changed_by
    ) VALUES (
        v_item.id, p_session_id, p_store_id, v_item.product_id, 'post_finalize_correction',
        v_previous_quantity, v_item.counted_quantity,
        v_previous_counted_at, v_item.counted_at,
        BTRIM(p_reason), v_user_id
    );

    RETURN jsonb_build_object(
        'sessionId', p_session_id,
        'storeId', p_store_id,
        'productId', v_item.product_id,
        'janCode', v_item.jan_snapshot,
        'quantity', v_item.counted_quantity,
        'countedAt', v_item.counted_at,
        'rowVersion', v_item.row_version
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.add_inventory_adjustment(
    p_session_id UUID,
    p_store_id INTEGER,
    p_jan_code TEXT,
    p_quantity_delta NUMERIC,
    p_reason TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := (SELECT auth.uid());
    v_product_id INTEGER;
    v_adjustment_id UUID;
    v_effective_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager']::TEXT[]) THEN
        RAISE EXCEPTION 'manager store access required' USING ERRCODE = '42501';
    END IF;
    IF p_quantity_delta IS NULL OR p_quantity_delta = 0 OR ABS(p_quantity_delta) > 99999999999.999
       OR p_reason IS NULL OR BTRIM(p_reason) = '' OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'valid adjustment, reason and idempotency key are required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.inventory_sessions AS session
         WHERE session.id = p_session_id AND session.store_id = p_store_id AND session.status = 'finalized'
    ) THEN
        RAISE EXCEPTION 'finalized inventory session not found' USING ERRCODE = '22023';
    END IF;

    SELECT product.id INTO v_product_id
      FROM public.products AS product
      JOIN public.inventory_balances AS balance
        ON balance.product_id = product.id
       AND balance.store_id = product.store_id
       AND balance.session_id = p_session_id
     WHERE product.store_id = p_store_id
       AND product.jan_code = BTRIM(p_jan_code);
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory product not found' USING ERRCODE = '22023'; END IF;

    INSERT INTO public.inventory_adjustments (
        store_id, product_id, quantity_delta, effective_at, reason,
        idempotency_key, created_by
    ) VALUES (
        p_store_id, v_product_id, p_quantity_delta, v_effective_at, BTRIM(p_reason),
        p_idempotency_key, v_user_id
    )
    ON CONFLICT (store_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_adjustment_id;

    IF v_adjustment_id IS NULL THEN
        SELECT adjustment.id, adjustment.effective_at
          INTO v_adjustment_id, v_effective_at
          FROM public.inventory_adjustments AS adjustment
         WHERE adjustment.store_id = p_store_id
           AND adjustment.idempotency_key = p_idempotency_key;
    END IF;

    RETURN jsonb_build_object(
        'adjustmentId', v_adjustment_id,
        'sessionId', p_session_id,
        'storeId', p_store_id,
        'productId', v_product_id,
        'janCode', BTRIM(p_jan_code),
        'quantityDelta', p_quantity_delta,
        'effectiveAt', v_effective_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_overview(
    p_store_id INTEGER,
    p_query TEXT DEFAULT '',
    p_stock_status TEXT DEFAULT 'all',
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session public.inventory_sessions%ROWTYPE;
    v_query TEXT := LEFT(BTRIM(COALESCE(p_query, '')), 100);
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_total BIGINT := 0;
    v_negative BIGINT := 0;
    v_adjusted BIGINT := 0;
    v_filtered BIGINT := 0;
    v_items JSONB := '[]'::JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_stock_status NOT IN ('all', 'negative', 'adjusted') THEN
        RAISE EXCEPTION 'invalid stock status' USING ERRCODE = '22023';
    END IF;

    SELECT session.* INTO v_session
      FROM public.inventory_sessions AS session
     WHERE session.store_id = p_store_id AND session.status = 'finalized'
     ORDER BY session.finalized_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'session', NULL,
            'summary', jsonb_build_object('totalCount', 0, 'negativeCount', 0, 'adjustedCount', 0),
            'items', '[]'::JSONB,
            'filteredCount', 0,
            'limit', v_limit,
            'offset', v_offset
        );
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE balance.calculated_quantity < 0),
        COUNT(*) FILTER (WHERE balance.adjustment_delta <> 0)
      INTO v_total, v_negative, v_adjusted
      FROM public.inventory_balances AS balance
     WHERE balance.store_id = p_store_id AND balance.session_id = v_session.id;

    SELECT COUNT(*) INTO v_filtered
      FROM public.inventory_balances AS balance
      JOIN public.inventory_session_items AS item ON item.id = balance.session_item_id
      JOIN public.products AS product ON product.id = balance.product_id AND product.store_id = balance.store_id
     WHERE balance.store_id = p_store_id
       AND balance.session_id = v_session.id
       AND (v_query = '' OR product.jan_code ILIKE '%' || v_query || '%'
            OR product.product_name ILIKE '%' || v_query || '%'
            OR COALESCE(product.category, '') ILIKE '%' || v_query || '%'
            OR COALESCE(product.supplier_name, '') ILIKE '%' || v_query || '%')
       AND (p_stock_status = 'all'
            OR (p_stock_status = 'negative' AND balance.calculated_quantity < 0)
            OR (p_stock_status = 'adjusted' AND balance.adjustment_delta <> 0));

    SELECT COALESCE(jsonb_agg(result.payload ORDER BY result.negative_sort DESC, result.name_sort), '[]'::JSONB)
      INTO v_items
      FROM (
        SELECT
            jsonb_build_object(
                'sessionId', balance.session_id,
                'sessionItemId', balance.session_item_id,
                'storeId', balance.store_id,
                'productId', balance.product_id,
                'janCode', product.jan_code,
                'productName', product.product_name,
                'category', product.category,
                'supplierName', product.supplier_name,
                'shelfCode', settings.shelf_code,
                'isActive', product.is_active,
                'physicalQuantity', balance.physical_quantity,
                'countedAt', balance.counted_at,
                'salesQuantity', balance.sales_quantity,
                'returnQuantity', balance.return_quantity,
                'transferInQuantity', balance.transfer_in_quantity,
                'transferOutQuantity', balance.transfer_out_quantity,
                'usageQuantity', balance.usage_quantity,
                'adjustmentDelta', balance.adjustment_delta,
                'calculatedQuantity', balance.calculated_quantity,
                'calculatedAsOf', balance.calculated_as_of,
                'rowVersion', item.row_version,
                'varianceThreshold', COALESCE(settings.variance_threshold, 0),
                'isLargeAdjustment', COALESCE(settings.variance_threshold, 0) > 0
                    AND ABS(balance.adjustment_delta) > settings.variance_threshold
            ) AS payload,
            balance.calculated_quantity < 0 AS negative_sort,
            product.product_name AS name_sort
          FROM public.inventory_balances AS balance
          JOIN public.inventory_session_items AS item ON item.id = balance.session_item_id
          JOIN public.products AS product ON product.id = balance.product_id AND product.store_id = balance.store_id
          LEFT JOIN public.inventory_product_settings AS settings
            ON settings.store_id = balance.store_id AND settings.product_id = balance.product_id
         WHERE balance.store_id = p_store_id
           AND balance.session_id = v_session.id
           AND (v_query = '' OR product.jan_code ILIKE '%' || v_query || '%'
                OR product.product_name ILIKE '%' || v_query || '%'
                OR COALESCE(product.category, '') ILIKE '%' || v_query || '%'
                OR COALESCE(product.supplier_name, '') ILIKE '%' || v_query || '%')
           AND (p_stock_status = 'all'
                OR (p_stock_status = 'negative' AND balance.calculated_quantity < 0)
                OR (p_stock_status = 'adjusted' AND balance.adjustment_delta <> 0))
         ORDER BY balance.calculated_quantity < 0 DESC, product.product_name
         LIMIT v_limit OFFSET v_offset
      ) AS result;

    RETURN jsonb_build_object(
        'session', jsonb_build_object(
            'id', v_session.id,
            'storeId', v_session.store_id,
            'status', v_session.status,
            'startedAt', v_session.started_at,
            'finalizedAt', v_session.finalized_at,
            'rowVersion', v_session.row_version
        ),
        'summary', jsonb_build_object(
            'totalCount', v_total,
            'negativeCount', v_negative,
            'adjustedCount', v_adjusted
        ),
        'items', v_items,
        'filteredCount', v_filtered,
        'limit', v_limit,
        'offset', v_offset
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_print_data(
    p_store_id INTEGER,
    p_session_id UUID DEFAULT NULL,
    p_mode TEXT DEFAULT 'blank',
    p_sort TEXT DEFAULT 'category'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session public.inventory_sessions%ROWTYPE;
    v_items JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_mode NOT IN ('blank', 'result') OR p_sort NOT IN ('category', 'supplier', 'shelf', 'name') THEN
        RAISE EXCEPTION 'invalid print options' USING ERRCODE = '22023';
    END IF;

    IF p_session_id IS NOT NULL THEN
        SELECT session.* INTO v_session FROM public.inventory_sessions AS session
         WHERE session.id = p_session_id AND session.store_id = p_store_id;
    ELSE
        SELECT session.* INTO v_session FROM public.inventory_sessions AS session
         WHERE session.store_id = p_store_id
           AND session.status IN ('draft', 'finalizing', 'finalized')
         ORDER BY (session.status IN ('draft', 'finalizing')) DESC,
                  session.started_at DESC LIMIT 1;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory session not found' USING ERRCODE = '22023'; END IF;

    SELECT COALESCE(jsonb_agg(result.payload ORDER BY result.sort_one, result.sort_two, result.product_name), '[]'::JSONB)
      INTO v_items
      FROM (
        SELECT
            jsonb_build_object(
                'janCode', item.jan_snapshot,
                'productName', item.product_name_snapshot,
                'category', item.category_snapshot,
                'supplierName', item.supplier_snapshot,
                'shelfCode', item.shelf_snapshot,
                'isActive', product.is_active,
                'excluded', item.excluded_at IS NOT NULL,
                'countedQuantity', item.counted_quantity,
                'countedAt', item.counted_at,
                'physicalQuantity', balance.physical_quantity,
                'salesQuantity', balance.sales_quantity,
                'returnQuantity', balance.return_quantity,
                'transferInQuantity', balance.transfer_in_quantity,
                'transferOutQuantity', balance.transfer_out_quantity,
                'usageQuantity', balance.usage_quantity,
                'adjustmentDelta', balance.adjustment_delta,
                'calculatedQuantity', balance.calculated_quantity,
                'calculatedAsOf', balance.calculated_as_of,
                'isLargeAdjustment', COALESCE(settings.variance_threshold, 0) > 0
                    AND ABS(COALESCE(balance.adjustment_delta, 0)) > settings.variance_threshold
            ) AS payload,
            CASE p_sort
                WHEN 'supplier' THEN COALESCE(item.supplier_snapshot, '')
                WHEN 'shelf' THEN COALESCE(item.shelf_snapshot, '')
                WHEN 'name' THEN item.product_name_snapshot
                ELSE COALESCE(item.category_snapshot, '')
            END AS sort_one,
            CASE p_sort
                WHEN 'supplier' THEN COALESCE(item.category_snapshot, '')
                WHEN 'shelf' THEN COALESCE(item.category_snapshot, '')
                ELSE COALESCE(item.supplier_snapshot, '')
            END AS sort_two,
            item.product_name_snapshot AS product_name
          FROM public.inventory_session_items AS item
          JOIN public.products AS product
            ON product.id = item.product_id AND product.store_id = item.store_id AND product.jan_code = item.jan_snapshot
          LEFT JOIN public.inventory_balances AS balance
            ON balance.session_id = item.session_id AND balance.session_item_id = item.id
           AND balance.store_id = item.store_id AND balance.product_id = item.product_id
          LEFT JOIN public.inventory_product_settings AS settings
            ON settings.store_id = item.store_id AND settings.product_id = item.product_id
         WHERE item.session_id = v_session.id AND item.store_id = p_store_id
      ) AS result;

    RETURN jsonb_build_object(
        'storeId', p_store_id,
        'sessionId', v_session.id,
        'status', v_session.status,
        'startedAt', v_session.started_at,
        'finalizedAt', v_session.finalized_at,
        'mode', p_mode,
        'sort', p_sort,
        'items', v_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.set_inventory_product_status(INTEGER, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_inventory_product_status(INTEGER, TEXT, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_inventory_product_status(INTEGER, TEXT, BOOLEAN, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.set_inventory_item_exclusion(UUID, INTEGER, TEXT, BOOLEAN, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_inventory_item_exclusion(UUID, INTEGER, TEXT, BOOLEAN, TEXT, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_inventory_item_exclusion(UUID, INTEGER, TEXT, BOOLEAN, TEXT, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.preview_inventory_finalization(UUID, INTEGER, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_inventory_finalization(UUID, INTEGER, UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_inventory_finalization(UUID, INTEGER, UUID, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.correct_finalized_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_finalized_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.correct_finalized_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.add_inventory_adjustment(UUID, INTEGER, TEXT, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_inventory_adjustment(UUID, INTEGER, TEXT, NUMERIC, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_inventory_adjustment(UUID, INTEGER, TEXT, NUMERIC, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inventory_overview(INTEGER, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_overview(INTEGER, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_overview(INTEGER, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inventory_print_data(INTEGER, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_print_data(INTEGER, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_print_data(INTEGER, UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_inventory_product_status(INTEGER, TEXT, BOOLEAN, TEXT) IS
    'managerがstore_id + JANで商品を手動停止/解除し、POS同期より優先するoverrideと監査を保存する。';
COMMENT ON FUNCTION public.preview_inventory_finalization(UUID, INTEGER, UUID, TIMESTAMPTZ) IS
    '残高投影を変更せず、固定POS snapshotで確定前問題と現在庫previewを返す。';
COMMENT ON FUNCTION public.correct_finalized_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) IS
    '確定済み物理数を元の計数時刻のまま理由付きで訂正し、append-only履歴を追加する。';
