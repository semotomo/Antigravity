-- service_role専用の操作受付/claim/結果記録。ブラウザ用の書込みRPCは公開しない。
CREATE FUNCTION private.assert_pos_product_manager(p_actor_id UUID,p_store_id INTEGER) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    -- 同じtransaction中の権限変更も競合させる。metadata/cookieは参照しない。
    PERFORM 1 FROM public.user_store_access a WHERE a.user_id=p_actor_id
        AND a.store_id=p_store_id AND a.role='manager' AND p_store_id IN (6,7) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'store manager access denied' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION private.validate_pos_product_command(p_text TEXT) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
    v JSONB; f JSONB; allowed TEXT[]; k TEXT;
BEGIN
    IF p_text IS NULL OR octet_length(p_text)>16384 THEN
        RAISE EXCEPTION 'invalid command' USING ERRCODE='22023';
    END IF;
    v := p_text::jsonb;
    IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR COALESCE(v->>'kind','') NOT IN ('create','update') THEN
        RAISE EXCEPTION 'unsupported command' USING ERRCODE='22023';
    END IF;
    allowed := CASE WHEN v->>'kind'='create' THEN ARRAY['kind','operationId','storeId','janCode','fields']
        ELSE ARRAY['kind','operationId','storeId','productId','expectedFingerprint','fields'] END;
    IF NOT (v ?& allowed) OR v-allowed <> '{}'::jsonb
        OR jsonb_typeof(v->'storeId') IS DISTINCT FROM 'number' OR COALESCE(v->>'storeId','') NOT IN ('6','7')
        OR jsonb_typeof(v->'operationId') IS DISTINCT FROM 'string'
        OR COALESCE(v->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'invalid command' USING ERRCODE='22023';
    END IF;
    IF v->>'kind'='create' THEN
        IF jsonb_typeof(v->'janCode') IS DISTINCT FROM 'string' OR COALESCE(v->>'janCode','') !~ '^(\d{8}|\d{12}|\d{13})$' THEN
            RAISE EXCEPTION 'invalid JAN' USING ERRCODE='22023';
        END IF;
    ELSE
        IF jsonb_typeof(v->'productId') IS DISTINCT FROM 'number' OR COALESCE(v->>'productId','') !~ '^[1-9][0-9]{0,9}$'
            OR jsonb_typeof(v->'expectedFingerprint') IS DISTINCT FROM 'string'
            OR COALESCE(v->>'expectedFingerprint','') !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'invalid product identity' USING ERRCODE='22023';
        END IF;
    END IF;
    f := v->'fields'; allowed := ARRAY['name','groupId','price','cost','supplierId'];
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT (f ?& allowed) OR f-allowed <> '{}'::jsonb THEN
        RAISE EXCEPTION 'invalid product fields' USING ERRCODE='22023';
    END IF;
    FOREACH k IN ARRAY ARRAY['name','groupId'] LOOP
        IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR length(btrim(f->>k))=0
            OR length(f->>k)>(CASE WHEN k='name' THEN 200 ELSE 100 END) OR f->>k ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'invalid product fields' USING ERRCODE='22023';
        END IF;
    END LOOP;
    FOREACH k IN ARRAY ARRAY['price','cost'] LOOP
        IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR COALESCE(f->>k,'') !~ '^\d{1,9}(\.\d{1,2})?$' THEN
            RAISE EXCEPTION 'invalid product amount' USING ERRCODE='22023';
        END IF;
    END LOOP;
    IF f->'supplierId' <> 'null'::jsonb AND (jsonb_typeof(f->'supplierId') IS DISTINCT FROM 'string'
        OR length(btrim(f->>'supplierId')) NOT BETWEEN 1 AND 100 OR f->>'supplierId' ~ '[[:cntrl:]]') THEN
        RAISE EXCEPTION 'invalid supplier' USING ERRCODE='22023';
    END IF;
    RETURN v;
END $$;

CREATE FUNCTION public.prepare_pos_product_operation(
    p_actor_id UUID,p_command_text TEXT,p_pos_product_id TEXT,p_expected_result_fingerprint TEXT
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v JSONB; op public.pos_product_operations; v_id UUID; v_store INTEGER;
    v_product INTEGER; v_jan TEXT; v_hash TEXT; v_resource TEXT;
BEGIN
    v := private.validate_pos_product_command(p_command_text);
    v_id := (v->>'operationId')::uuid; v_store := (v->>'storeId')::integer;
    PERFORM private.assert_pos_product_manager(p_actor_id,v_store);
    IF p_expected_result_fingerprint IS NULL OR p_expected_result_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid result fingerprint' USING ERRCODE='22023';
    END IF;
    v_hash := encode(sha256(convert_to(p_command_text,'UTF8')),'hex');
    -- まだ存在しない操作IDも排他する。hash衝突は余分な待機になるだけで認可に使わない。
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-operation:'||v_id::text,0));
    SELECT * INTO op FROM public.pos_product_operations WHERE id=v_id FOR UPDATE;
    IF FOUND THEN
        IF op.actor_id IS DISTINCT FROM p_actor_id OR op.store_id<>v_store OR op.payload_hash<>v_hash
            OR op.command_text<>p_command_text OR op.pos_product_id IS DISTINCT FROM p_pos_product_id
            OR op.expected_result_fingerprint<>p_expected_result_fingerprint THEN
            RAISE EXCEPTION 'operation conflict' USING ERRCODE='22023';
        END IF;
        RETURN to_jsonb(op);
    END IF;
    IF v->>'kind'='create' THEN
        v_jan := v->>'janCode';
        IF p_pos_product_id IS NOT NULL THEN RAISE EXCEPTION 'invalid create identity' USING ERRCODE='22023'; END IF;
        IF EXISTS (SELECT 1 FROM public.products WHERE store_id=v_store AND jan_code=v_jan) THEN
            RAISE EXCEPTION 'product already exists' USING ERRCODE='23505';
        END IF;
    ELSE
        v_product := (v->>'productId')::integer;
        SELECT jan_code INTO v_jan FROM public.products WHERE id=v_product AND store_id=v_store FOR SHARE;
        IF NOT FOUND OR v_jan IS NULL OR v_jan !~ '^(\d{8}|\d{12}|\d{13})$' THEN
            RAISE EXCEPTION 'product unavailable' USING ERRCODE='22023';
        END IF;
        IF p_pos_product_id IS NULL OR p_pos_product_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
            RAISE EXCEPTION 'invalid POS identity' USING ERRCODE='22023';
        END IF;
    END IF;
    INSERT INTO public.pos_product_operations(id,store_id,actor_id,kind,product_id_snapshot,jan_code,
        pos_product_id,command_text,payload_hash,expected_result_fingerprint)
    VALUES(v_id,v_store,p_actor_id,v->>'kind',v_product,v_jan,p_pos_product_id,p_command_text,v_hash,p_expected_result_fingerprint)
    RETURNING * INTO op;
    BEGIN
        FOR v_resource IN SELECT r FROM unnest(ARRAY['jan:'||v_jan,
            CASE WHEN v_product IS NOT NULL THEN 'product:'||v_product::text END]) r WHERE r IS NOT NULL ORDER BY r LOOP
            INSERT INTO public.pos_product_operation_locks(store_id,resource_key,operation_id) VALUES(v_store,v_resource,v_id);
        END LOOP;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'product resource busy' USING ERRCODE='55P03';
    END;
    RETURN to_jsonb(op);
END $$;

CREATE FUNCTION private.lock_pos_product_operation(p_actor UUID,p_store INTEGER,p_id UUID,p_hash TEXT)
RETURNS public.pos_product_operations LANGUAGE plpgsql SET search_path='' AS $$
DECLARE op public.pos_product_operations;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor,p_store);
    SELECT * INTO op FROM public.pos_product_operations
        WHERE id=p_id AND actor_id=p_actor AND store_id=p_store AND payload_hash=p_hash FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'operation unavailable' USING ERRCODE='42501'; END IF;
    RETURN op;
END $$;

CREATE FUNCTION public.claim_pos_product_operation(
    p_actor_id UUID,p_store_id INTEGER,p_operation_id UUID,p_payload_hash TEXT,p_expected_version BIGINT
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations;
BEGIN
    op := private.lock_pos_product_operation(p_actor_id,p_store_id,p_operation_id,p_payload_hash);
    IF op.status <> 'prepared' THEN
        RETURN jsonb_build_object('claimed',false,'operation',to_jsonb(op));
    END IF;
    IF op.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'operation version conflict' USING ERRCODE='40001';
    END IF;
    IF op.dispatch_expires_at<=clock_timestamp() THEN
        RAISE EXCEPTION 'prepared operation expired' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pos_product_operation_locks
        WHERE operation_id=op.id AND store_id=op.store_id AND resource_key='jan:'||op.jan_code)
        OR (op.kind='update' AND NOT EXISTS (SELECT 1 FROM public.pos_product_operation_locks
            WHERE operation_id=op.id AND store_id=op.store_id AND resource_key='product:'||op.product_id_snapshot::text)) THEN
        RAISE EXCEPTION 'product reservation unavailable' USING ERRCODE='22023';
    END IF;
    IF op.kind='update' THEN
        PERFORM 1 FROM public.products WHERE id=op.product_id_snapshot AND store_id=op.store_id
            AND jan_code=op.jan_code FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'product identity changed' USING ERRCODE='22023'; END IF;
    ELSIF EXISTS (SELECT 1 FROM public.products WHERE store_id=op.store_id AND jan_code=op.jan_code) THEN
        RAISE EXCEPTION 'product already exists' USING ERRCODE='23505';
    END IF;
    UPDATE public.pos_product_operations SET status='dispatching',send_attempts=1,
        row_version=row_version+1,last_event='claim_dispatch' WHERE id=op.id RETURNING * INTO op;
    RETURN jsonb_build_object('claimed',true,'operation',to_jsonb(op));
END $$;

CREATE FUNCTION public.record_pos_product_operation_result(
    p_actor_id UUID,p_store_id INTEGER,p_operation_id UUID,p_payload_hash TEXT,p_expected_version BIGINT,
    p_event TEXT,p_verified_fingerprint TEXT DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; v_status TEXT;
BEGIN
    op := private.lock_pos_product_operation(p_actor_id,p_store_id,p_operation_id,p_payload_hash);
    IF op.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'operation version conflict' USING ERRCODE='40001';
    END IF;
    IF p_event='reject_before_dispatch' AND op.status='prepared' THEN v_status:='rejected';
    ELSIF p_event='dispatch_returned' AND op.status='dispatching' THEN v_status:='verifying';
    ELSIF p_event='outcome_unknown' AND op.status IN ('dispatching','verifying','uncertain') THEN v_status:='uncertain';
    ELSIF p_event='pos_verified' AND op.status IN ('verifying','uncertain') THEN
        IF p_verified_fingerprint IS DISTINCT FROM op.expected_result_fingerprint THEN
            RAISE EXCEPTION 'POS fingerprint mismatch' USING ERRCODE='22023';
        END IF;
        v_status:='pos_confirmed';
    ELSIF p_event='db_failed' AND op.status IN ('pos_confirmed','db_pending') THEN v_status:='db_pending';
    ELSE
        -- DB完了は商品反映と同一transactionの専用RPCで行う。汎用イベントでは受け付けない。
        RAISE EXCEPTION 'invalid transition' USING ERRCODE='22023';
    END IF;
    IF p_event<>'pos_verified' AND p_verified_fingerprint IS NOT NULL THEN
        RAISE EXCEPTION 'unexpected fingerprint' USING ERRCODE='22023';
    END IF;
    UPDATE public.pos_product_operations SET status=v_status,row_version=row_version+1,last_event=p_event,
        verified_fingerprint=CASE WHEN p_event='pos_verified' THEN p_verified_fingerprint ELSE verified_fingerprint END
        WHERE id=op.id RETURNING * INTO op;
    IF v_status='rejected' THEN DELETE FROM public.pos_product_operation_locks WHERE operation_id=op.id; END IF;
    RETURN to_jsonb(op);
END $$;

REVOKE ALL ON FUNCTION private.assert_pos_product_manager(UUID,INTEGER), private.validate_pos_product_command(TEXT),
    private.lock_pos_product_operation(UUID,INTEGER,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_pos_product_operation(UUID,TEXT,TEXT,TEXT),
    public.claim_pos_product_operation(UUID,INTEGER,UUID,TEXT,BIGINT),
    public.record_pos_product_operation_result(UUID,INTEGER,UUID,TEXT,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_pos_product_operation(UUID,TEXT,TEXT,TEXT),
    public.claim_pos_product_operation(UUID,INTEGER,UUID,TEXT,BIGINT),
    public.record_pos_product_operation_result(UUID,INTEGER,UUID,TEXT,BIGINT,TEXT,TEXT) TO service_role;
