-- 棚卸し・在庫管理 Phase 3
-- 店舗別の下書き開始、一覧取得、商品別数量保存を認証付きRPCとして追加する。

CREATE OR REPLACE FUNCTION public.start_inventory_session(
    p_store_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := (SELECT auth.uid());
    v_session public.inventory_sessions%ROWTYPE;
    v_total_count BIGINT;
    v_counted_count BIGINT;
    v_uncounted_count BIGINT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('inventory-session:' || p_store_id::TEXT, 0)
    );

    SELECT session_row.*
      INTO v_session
      FROM public.inventory_sessions AS session_row
     WHERE session_row.store_id = p_store_id
       AND session_row.status IN ('draft', 'finalizing')
     ORDER BY session_row.started_at DESC
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.inventory_sessions (
            store_id,
            status,
            started_by,
            updated_by
        )
        VALUES (
            p_store_id,
            'draft',
            v_user_id,
            v_user_id
        )
        RETURNING * INTO v_session;

        INSERT INTO public.inventory_session_items (
            session_id,
            store_id,
            product_id,
            jan_snapshot,
            product_name_snapshot,
            category_snapshot,
            supplier_snapshot,
            shelf_snapshot,
            created_by,
            updated_by
        )
        SELECT
            v_session.id,
            product.store_id,
            product.id,
            product.jan_code,
            COALESCE(NULLIF(BTRIM(product.product_name), ''), '商品名未設定'),
            product.category,
            product.supplier_name,
            settings.shelf_code,
            v_user_id,
            v_user_id
        FROM public.products AS product
        LEFT JOIN public.inventory_product_settings AS settings
          ON settings.store_id = product.store_id
         AND settings.product_id = product.id
        WHERE product.store_id = p_store_id
          AND product.jan_code IS NOT NULL
          AND BTRIM(product.jan_code) <> ''
        ON CONFLICT (session_id, product_id) DO NOTHING;

        IF NOT EXISTS (
            SELECT 1
              FROM public.inventory_session_items AS item
             WHERE item.session_id = v_session.id
               AND item.store_id = p_store_id
        ) THEN
            RAISE EXCEPTION 'no inventory products found';
        END IF;
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE item.counted_quantity IS NOT NULL),
        COUNT(*) FILTER (
            WHERE item.counted_quantity IS NULL
              AND item.excluded_at IS NULL
        )
      INTO v_total_count, v_counted_count, v_uncounted_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = v_session.id
       AND item.store_id = p_store_id;

    RETURN jsonb_build_object(
        'sessionId', v_session.id,
        'storeId', v_session.store_id,
        'status', v_session.status,
        'startedAt', v_session.started_at,
        'rowVersion', v_session.row_version,
        'totalCount', v_total_count,
        'countedCount', v_counted_count,
        'uncountedCount', v_uncounted_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_workspace(
    p_store_id INTEGER,
    p_session_id UUID DEFAULT NULL,
    p_query TEXT DEFAULT '',
    p_count_status TEXT DEFAULT 'all',
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
    v_user_id UUID := (SELECT auth.uid());
    v_session public.inventory_sessions%ROWTYPE;
    v_query TEXT := LEFT(BTRIM(COALESCE(p_query, '')), 100);
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_total_count BIGINT := 0;
    v_counted_count BIGINT := 0;
    v_uncounted_count BIGINT := 0;
    v_excluded_count BIGINT := 0;
    v_filtered_count BIGINT := 0;
    v_items JSONB := '[]'::JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_count_status NOT IN ('all', 'counted', 'uncounted') THEN
        RAISE EXCEPTION 'invalid count status';
    END IF;

    IF p_session_id IS NULL THEN
        SELECT session_row.*
          INTO v_session
          FROM public.inventory_sessions AS session_row
         WHERE session_row.store_id = p_store_id
           AND session_row.status IN ('draft', 'finalizing')
         ORDER BY session_row.started_at DESC
         LIMIT 1;
    ELSE
        SELECT session_row.*
          INTO v_session
          FROM public.inventory_sessions AS session_row
         WHERE session_row.id = p_session_id
           AND session_row.store_id = p_store_id
         LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'session', NULL,
            'progress', jsonb_build_object(
                'totalCount', 0,
                'countedCount', 0,
                'uncountedCount', 0,
                'excludedCount', 0,
                'progressRate', 0
            ),
            'items', '[]'::JSONB,
            'filteredCount', 0,
            'limit', v_limit,
            'offset', v_offset
        );
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE item.counted_quantity IS NOT NULL),
        COUNT(*) FILTER (
            WHERE item.counted_quantity IS NULL
              AND item.excluded_at IS NULL
        ),
        COUNT(*) FILTER (WHERE item.excluded_at IS NOT NULL)
      INTO v_total_count, v_counted_count, v_uncounted_count, v_excluded_count
      FROM public.inventory_session_items AS item
     WHERE item.session_id = v_session.id
       AND item.store_id = p_store_id;

    SELECT COUNT(*)
      INTO v_filtered_count
      FROM public.inventory_session_items AS item
      JOIN public.products AS product
        ON product.id = item.product_id
       AND product.store_id = item.store_id
       AND product.jan_code = item.jan_snapshot
     WHERE item.session_id = v_session.id
       AND item.store_id = p_store_id
       AND (
            v_query = ''
            OR item.jan_snapshot ILIKE '%' || v_query || '%'
            OR item.product_name_snapshot ILIKE '%' || v_query || '%'
            OR COALESCE(item.category_snapshot, '') ILIKE '%' || v_query || '%'
            OR COALESCE(item.supplier_snapshot, '') ILIKE '%' || v_query || '%'
            OR COALESCE(item.shelf_snapshot, '') ILIKE '%' || v_query || '%'
       )
       AND (
            p_count_status = 'all'
            OR (p_count_status = 'counted' AND item.counted_quantity IS NOT NULL)
            OR (
                p_count_status = 'uncounted'
                AND item.counted_quantity IS NULL
                AND item.excluded_at IS NULL
            )
       );

    SELECT COALESCE(jsonb_agg(result.item_payload ORDER BY result.sort_uncounted DESC, result.sort_name, result.sort_id), '[]'::JSONB)
      INTO v_items
      FROM (
        SELECT
            jsonb_build_object(
                'id', item.id,
                'sessionId', item.session_id,
                'storeId', item.store_id,
                'productId', item.product_id,
                'janSnapshot', item.jan_snapshot,
                'productNameSnapshot', item.product_name_snapshot,
                'categorySnapshot', item.category_snapshot,
                'supplierSnapshot', item.supplier_snapshot,
                'shelfSnapshot', item.shelf_snapshot,
                'countedQuantity', item.counted_quantity,
                'countedAt', item.counted_at,
                'excludedAt', item.excluded_at,
                'exclusionReason', item.exclusion_reason,
                'rowVersion', item.row_version,
                'isActive', product.is_active
            ) AS item_payload,
            (item.counted_quantity IS NULL AND item.excluded_at IS NULL) AS sort_uncounted,
            item.product_name_snapshot AS sort_name,
            item.id AS sort_id
          FROM public.inventory_session_items AS item
          JOIN public.products AS product
            ON product.id = item.product_id
           AND product.store_id = item.store_id
           AND product.jan_code = item.jan_snapshot
         WHERE item.session_id = v_session.id
           AND item.store_id = p_store_id
           AND (
                v_query = ''
                OR item.jan_snapshot ILIKE '%' || v_query || '%'
                OR item.product_name_snapshot ILIKE '%' || v_query || '%'
                OR COALESCE(item.category_snapshot, '') ILIKE '%' || v_query || '%'
                OR COALESCE(item.supplier_snapshot, '') ILIKE '%' || v_query || '%'
                OR COALESCE(item.shelf_snapshot, '') ILIKE '%' || v_query || '%'
           )
           AND (
                p_count_status = 'all'
                OR (p_count_status = 'counted' AND item.counted_quantity IS NOT NULL)
                OR (
                    p_count_status = 'uncounted'
                    AND item.counted_quantity IS NULL
                    AND item.excluded_at IS NULL
                )
           )
         ORDER BY
            (item.counted_quantity IS NULL AND item.excluded_at IS NULL) DESC,
            item.product_name_snapshot,
            item.id
         LIMIT v_limit
        OFFSET v_offset
      ) AS result;

    RETURN jsonb_build_object(
        'session', jsonb_build_object(
            'id', v_session.id,
            'storeId', v_session.store_id,
            'status', v_session.status,
            'startedAt', v_session.started_at,
            'updatedAt', v_session.updated_at,
            'rowVersion', v_session.row_version
        ),
        'progress', jsonb_build_object(
            'totalCount', v_total_count,
            'countedCount', v_counted_count,
            'uncountedCount', v_uncounted_count,
            'excludedCount', v_excluded_count,
            'progressRate', CASE
                WHEN v_total_count = 0 THEN 0
                ELSE ROUND(((v_counted_count + v_excluded_count)::NUMERIC / v_total_count::NUMERIC) * 100, 1)
            END
        ),
        'items', v_items,
        'filteredCount', v_filtered_count,
        'limit', v_limit,
        'offset', v_offset
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_inventory_count(
    p_session_id UUID,
    p_store_id INTEGER,
    p_jan_code TEXT,
    p_quantity NUMERIC,
    p_mode TEXT,
    p_expected_row_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := (SELECT auth.uid());
    v_session public.inventory_sessions%ROWTYPE;
    v_item public.inventory_session_items%ROWTYPE;
    v_previous_quantity NUMERIC(14, 3);
    v_previous_counted_at TIMESTAMPTZ;
    v_new_quantity NUMERIC(14, 3);
    v_new_counted_at TIMESTAMPTZ;
    v_change_kind TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_is_active BOOLEAN;
    v_total_count BIGINT;
    v_counted_count BIGINT;
    v_uncounted_count BIGINT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_store_id NOT IN (6, 7)
       OR NOT private.can_access_store(p_store_id, ARRAY['manager', 'staff']::TEXT[]) THEN
        RAISE EXCEPTION 'store access denied' USING ERRCODE = '42501';
    END IF;
    IF p_session_id IS NULL OR p_jan_code IS NULL OR BTRIM(p_jan_code) = '' THEN
        RAISE EXCEPTION 'session and JAN are required';
    END IF;
    IF p_quantity IS NULL OR p_quantity < 0 OR p_quantity > 99999999999.999 THEN
        RAISE EXCEPTION 'invalid counted quantity';
    END IF;
    IF p_mode NOT IN ('initial', 'add', 'replace') THEN
        RAISE EXCEPTION 'invalid count mode';
    END IF;
    IF p_expected_row_version IS NULL OR p_expected_row_version < 1 THEN
        RAISE EXCEPTION 'expected row version is required';
    END IF;

    SELECT session_row.*
      INTO v_session
      FROM public.inventory_sessions AS session_row
     WHERE session_row.id = p_session_id
       AND session_row.store_id = p_store_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory session not found';
    END IF;
    IF v_session.status <> 'draft' THEN
        RAISE EXCEPTION 'inventory session is not editable';
    END IF;

    SELECT item.*
      INTO v_item
      FROM public.inventory_session_items AS item
     WHERE item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.jan_snapshot = BTRIM(p_jan_code)
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory product not found in session';
    END IF;
    IF v_item.row_version <> p_expected_row_version THEN
        RAISE EXCEPTION 'inventory item was updated by another user' USING ERRCODE = '40001';
    END IF;
    IF v_item.excluded_at IS NOT NULL THEN
        RAISE EXCEPTION 'excluded inventory item is not editable';
    END IF;

    v_previous_quantity := v_item.counted_quantity;
    v_previous_counted_at := v_item.counted_at;

    IF p_mode = 'initial' THEN
        IF v_previous_quantity IS NOT NULL THEN
            RAISE EXCEPTION 'inventory item is already counted';
        END IF;
        v_new_quantity := p_quantity;
        v_new_counted_at := v_now;
        v_change_kind := 'initial_count';
    ELSIF p_mode = 'add' THEN
        IF v_previous_quantity IS NULL OR v_previous_counted_at IS NULL THEN
            RAISE EXCEPTION 'inventory item has no quantity to add to';
        END IF;
        IF p_quantity > 99999999999.999 - v_previous_quantity THEN
            RAISE EXCEPTION 'counted quantity exceeds limit';
        END IF;
        v_new_quantity := v_previous_quantity + p_quantity;
        v_new_counted_at := v_previous_counted_at;
        v_change_kind := 'add';
    ELSIF p_mode = 'replace' THEN
        v_new_quantity := p_quantity;
        v_new_counted_at := v_now;
        v_change_kind := CASE
            WHEN v_previous_quantity IS NULL THEN 'initial_count'
            ELSE 'replace'
        END;
    ELSE
        RAISE EXCEPTION 'invalid count mode';
    END IF;

    IF v_new_quantity > 99999999999.999 THEN
        RAISE EXCEPTION 'counted quantity exceeds limit';
    END IF;

    UPDATE public.inventory_session_items AS item
       SET counted_quantity = v_new_quantity,
           counted_at = v_new_counted_at,
           counted_by = v_user_id,
           updated_at = v_now,
           updated_by = v_user_id
     WHERE item.id = v_item.id
       AND item.session_id = p_session_id
       AND item.store_id = p_store_id
       AND item.row_version = p_expected_row_version
    RETURNING item.* INTO v_item;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'inventory item was updated by another user' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.inventory_count_changes (
        item_id,
        session_id,
        store_id,
        product_id,
        change_kind,
        previous_quantity,
        new_quantity,
        previous_counted_at,
        new_counted_at,
        changed_by
    )
    VALUES (
        v_item.id,
        p_session_id,
        p_store_id,
        v_item.product_id,
        v_change_kind,
        v_previous_quantity,
        v_new_quantity,
        v_previous_counted_at,
        v_new_counted_at,
        v_user_id
    );

    SELECT product.is_active
      INTO v_is_active
      FROM public.products AS product
     WHERE product.id = v_item.product_id
       AND product.store_id = p_store_id
       AND product.jan_code = v_item.jan_snapshot;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE item.counted_quantity IS NOT NULL),
        COUNT(*) FILTER (
            WHERE item.counted_quantity IS NULL
              AND item.excluded_at IS NULL
        )
      INTO v_total_count, v_counted_count, v_uncounted_count
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
            'isActive', v_is_active
        ),
        'progress', jsonb_build_object(
            'totalCount', v_total_count,
            'countedCount', v_counted_count,
            'uncountedCount', v_uncounted_count,
            'progressRate', CASE
                WHEN v_total_count = 0 THEN 0
                ELSE ROUND((v_counted_count::NUMERIC / v_total_count::NUMERIC) * 100, 1)
            END
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.start_inventory_session(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_inventory_session(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_inventory_session(INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inventory_workspace(INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_workspace(INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_workspace(INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.save_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) TO authenticated;

COMMENT ON FUNCTION public.start_inventory_session(INTEGER) IS
    '店舗別のactive棚卸しを再開し、なければ停止商品を含む商品snapshotを作成する。';
COMMENT ON FUNCTION public.get_inventory_workspace(INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER) IS
    '認可済み店舗の棚卸し進捗と検索済み商品行を返す。NULL数量は未入力、0は入力済み。';
COMMENT ON FUNCTION public.save_inventory_count(UUID, INTEGER, TEXT, NUMERIC, TEXT, BIGINT) IS
    'store_id + JANとrow versionを検証して数量を保存し、変更履歴を追記する。addは元のcounted_atを維持する。';
