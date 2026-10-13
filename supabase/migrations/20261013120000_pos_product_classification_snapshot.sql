-- 検証済みPOS選択肢と現在選択を固定する。商品保存・本番有効化はこのmigrationに含めない。
BEGIN;
DO $classification_source$
BEGIN
    IF (SELECT encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex') FROM pg_proc
        WHERE oid='public.prepare_pos_product_edit_intake(uuid,uuid,text,text,text,text,text,text,text,bigint,text)'::regprocedure)
        IS DISTINCT FROM '72ee1df485221f03e4828a288f43c497ac5e6be098e0d41e6248a41136b99c63'
        OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex') FROM pg_proc
            WHERE oid='private.guard_pos_product_edit_intake()'::regprocedure)
            IS DISTINCT FROM '0fc3f57d8f69b6c86eab6b198cc556769dcf78c788d995e533a65f397ca82c54' THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_SOURCE_MISMATCH' USING ERRCODE='55000';
    END IF;
END $classification_source$;

CREATE TABLE public.pos_product_classification_snapshots (
    snapshot_id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    store_id integer NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT CHECK(store_id IN (6,7)),
    product_id integer NOT NULL CHECK(product_id>0),
    jan_code text NOT NULL CHECK(jan_code ~ '^(\d{8}|\d{12}|\d{13})$'),
    captured_at bigint NOT NULL CHECK(captured_at>0),
    expires_at bigint NOT NULL CHECK(expires_at>captured_at AND expires_at-captured_at<=900000),
    current_group_id text NOT NULL CHECK(current_group_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
    current_supplier_id text CHECK(current_supplier_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
    groups jsonb NOT NULL CHECK(jsonb_typeof(groups)='array'),
    suppliers jsonb NOT NULL CHECK(jsonb_typeof(suppliers)='array'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(snapshot_id,store_id,product_id,jan_code)
);
CREATE INDEX pos_product_classification_snapshot_target ON public.pos_product_classification_snapshots(store_id,product_id,jan_code,captured_at DESC);
ALTER TABLE public.pos_product_classification_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_classification_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_classification_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pos_product_classification_snapshots TO authenticated;
CREATE POLICY pos_product_classification_manager_read ON public.pos_product_classification_snapshots FOR SELECT TO authenticated
    USING(private.can_access_store(store_id,ARRAY['manager']::text[]));
CREATE TRIGGER pos_product_classification_snapshot_immutable BEFORE UPDATE OR DELETE ON public.pos_product_classification_snapshots
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_classification_snapshot_no_truncate BEFORE TRUNCATE ON public.pos_product_classification_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

CREATE FUNCTION private.validate_pos_product_classification_choices(p_choices jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE choice_value jsonb;
BEGIN
    IF jsonb_typeof(p_choices) IS DISTINCT FROM 'array' OR jsonb_array_length(p_choices)>5000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    FOR choice_value IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
        IF jsonb_typeof(choice_value) IS DISTINCT FROM 'object' OR NOT choice_value ?& ARRAY['id','name'] OR choice_value-ARRAY['id','name']<>'{}'::jsonb
            OR jsonb_typeof(choice_value->'id') IS DISTINCT FROM 'string' OR choice_value->>'id' !~ '^[A-Za-z0-9._:-]{1,100}$'
            OR jsonb_typeof(choice_value->'name') IS DISTINCT FROM 'string' OR length(choice_value->>'name') NOT BETWEEN 1 AND 1000
            OR choice_value->>'name'<>btrim(choice_value->>'name') OR choice_value->>'name' ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
        END IF;
    END LOOP;
    -- 同じ表示名の異IDを、先頭候補や文字列正規化で決めない。
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_choices) item GROUP BY item->>'id' HAVING count(*)>1)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_choices) item GROUP BY item->>'name' HAVING count(*)>1) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
END $$;

CREATE FUNCTION private.pos_product_classification_snapshot_json(s public.pos_product_classification_snapshots) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT jsonb_build_object('snapshotId',s.snapshot_id,'storeId',s.store_id,'productId',s.product_id,'janCode',s.jan_code,
        'capturedAt',s.captured_at,'expiresAt',s.expires_at,'currentGroupId',s.current_group_id,'currentSupplierId',s.current_supplier_id,
        'groups',s.groups,'suppliers',s.suppliers)
$$;

-- service専用。呼出元は署名付きPOS読取りを厳格decoderで検証してからDTOだけを渡す。
-- Cookie、CSRF、フォーム、資格情報を含む任意のブラウザcatalogをこの入口へ転送しない。
CREATE FUNCTION public.record_pos_product_classification_snapshot(p_actor_id uuid,p_store_id integer,p_product_id integer,
    p_snapshot_id uuid,p_snapshot_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb; s public.pos_product_classification_snapshots; p public.products; now_ms bigint; captured bigint; expiry bigint;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_snapshot_id IS NULL OR p_snapshot_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_product_id IS NULL OR p_product_id<=0 OR p_snapshot_text IS NULL OR octet_length(p_snapshot_text) NOT BETWEEN 1 AND 2000000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    BEGIN v:=private.pos_product_dispatch_json(p_snapshot_text);
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '22P02' THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END;
    IF jsonb_typeof(v) IS DISTINCT FROM 'object'
        OR NOT v ?& ARRAY['storeId','productId','janCode','capturedAt','expiresAt','currentGroupId','currentSupplierId','groups','suppliers']
        OR v-ARRAY['storeId','productId','janCode','capturedAt','expiresAt','currentGroupId','currentSupplierId','groups','suppliers']<>'{}'::jsonb
        OR v->'storeId' IS DISTINCT FROM to_jsonb(p_store_id) OR v->'productId' IS DISTINCT FROM to_jsonb(p_product_id)
        OR jsonb_typeof(v->'janCode') IS DISTINCT FROM 'string' OR v->>'janCode' !~ '^(\d{8}|\d{12}|\d{13})$'
        OR jsonb_typeof(v->'capturedAt') IS DISTINCT FROM 'number' OR v->>'capturedAt' !~ '^[1-9][0-9]{0,15}$'
        OR jsonb_typeof(v->'expiresAt') IS DISTINCT FROM 'number' OR v->>'expiresAt' !~ '^[1-9][0-9]{0,15}$'
        OR jsonb_typeof(v->'currentGroupId') IS DISTINCT FROM 'string' OR v->>'currentGroupId' !~ '^[A-Za-z0-9._:-]{1,100}$'
        OR (jsonb_typeof(v->'currentSupplierId') IS DISTINCT FROM 'null'
            AND (jsonb_typeof(v->'currentSupplierId') IS DISTINCT FROM 'string' OR v->>'currentSupplierId' !~ '^[A-Za-z0-9._:-]{1,100}$')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    PERFORM private.validate_pos_product_classification_choices(v->'groups');
    PERFORM private.validate_pos_product_classification_choices(v->'suppliers');
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'groups') g WHERE g->'id'=v->'currentGroupId')
        OR (v->'currentSupplierId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'suppliers') supplier_choice WHERE supplier_choice->'id'=v->'currentSupplierId')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    SELECT * INTO p FROM public.products WHERE id=p_product_id AND store_id=p_store_id AND jan_code=v->>'janCode';
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-classification:'||p_snapshot_id::text,0));
    SELECT * INTO s FROM public.pos_product_classification_snapshots WHERE snapshot_id=p_snapshot_id;
    IF FOUND THEN
        IF s.actor_id<>p_actor_id OR private.pos_product_classification_snapshot_json(s)-'snapshotId' IS DISTINCT FROM v THEN
            RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
        END IF;
        RETURN private.pos_product_classification_snapshot_json(s);
    END IF;
    captured:=(v->>'capturedAt')::bigint; expiry:=(v->>'expiresAt')::bigint;
    now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    IF captured>9007199254740991 OR expiry>9007199254740991 OR captured>now_ms+30000 OR now_ms-captured>900000
        OR expiry<=now_ms OR expiry<=captured OR expiry-captured>900000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.pos_product_classification_snapshots(snapshot_id,actor_id,store_id,product_id,jan_code,captured_at,expires_at,
        current_group_id,current_supplier_id,groups,suppliers)
        VALUES(p_snapshot_id,p_actor_id,p_store_id,p_product_id,p.jan_code,captured,expiry,v->>'currentGroupId',v->>'currentSupplierId',v->'groups',v->'suppliers') RETURNING * INTO s;
    RETURN private.pos_product_classification_snapshot_json(s);
END $$;

CREATE FUNCTION public.get_pos_product_classification_snapshot(p_actor_id uuid,p_store_id integer,p_product_id integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.pos_product_classification_snapshots;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_product_id IS NULL OR p_product_id<=0 THEN RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023'; END IF;
    SELECT cache.* INTO s FROM public.pos_product_classification_snapshots cache JOIN public.products p
        ON p.id=cache.product_id AND p.store_id=cache.store_id AND p.jan_code=cache.jan_code
        WHERE cache.store_id=p_store_id AND cache.product_id=p_product_id
            AND cache.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint
        ORDER BY cache.captured_at DESC,cache.created_at DESC,cache.snapshot_id LIMIT 1;
    RETURN CASE WHEN FOUND THEN private.pos_product_classification_snapshot_json(s) ELSE 'null'::jsonb END;
END $$;

ALTER TABLE public.pos_product_edit_intakes ADD COLUMN catalog_snapshot_id uuid,
    ADD COLUMN pos_choice_baseline jsonb;
ALTER TABLE public.pos_product_edit_intakes ADD CONSTRAINT pos_product_intake_classification_target
    FOREIGN KEY(catalog_snapshot_id,store_id,product_id,jan_code)
    REFERENCES public.pos_product_classification_snapshots(snapshot_id,store_id,product_id,jan_code) ON DELETE RESTRICT;
ALTER TABLE public.pos_product_edit_intakes DROP CONSTRAINT pos_product_edit_intakes_patch_check;
ALTER TABLE public.pos_product_edit_intakes ADD CONSTRAINT pos_product_edit_intakes_patch_check
    CHECK(jsonb_typeof(patch)='object' AND patch<>'{}'::jsonb AND patch-ARRAY['name','price','cost','groupId','supplierId']='{}'::jsonb);
ALTER TABLE public.pos_product_edit_intakes ADD CONSTRAINT pos_product_intake_classification_evidence
    CHECK(CASE WHEN patch ?| ARRAY['groupId','supplierId'] THEN catalog_snapshot_id IS NOT NULL AND pos_choice_baseline IS NOT NULL AND jsonb_typeof(pos_choice_baseline)='object'
        ELSE catalog_snapshot_id IS NULL AND pos_choice_baseline IS NULL END);
-- 既存intake guardはJSON全体から変更可能工程欄だけを除外するため、新しい証拠欄もそのままimmutableになる。

CREATE FUNCTION public.enqueue_pos_product_edit_intake_v2(p_actor_id uuid,p_store_id integer,p_product_id integer,p_operation_id uuid,
    p_patch_text text,p_expected_values_text text,p_catalog_snapshot_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; p public.products; s public.pos_product_classification_snapshots;
    patch jsonb; expected_values jsonb; k text; choices jsonb; baseline jsonb; now_ms bigint; requested jsonb:='{}'::jsonb;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_operation_id IS NULL OR p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_product_id IS NULL OR p_product_id<=0 OR p_catalog_snapshot_id IS NULL OR p_patch_text IS NULL
        OR octet_length(p_patch_text) NOT BETWEEN 1 AND 4096 OR p_expected_values_text IS NULL OR octet_length(p_expected_values_text) NOT BETWEEN 1 AND 4096 THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    BEGIN
        patch:=private.pos_product_dispatch_json(p_patch_text); expected_values:=private.pos_product_dispatch_json(p_expected_values_text);
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '22P02' THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END;
    IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR NOT patch ?| ARRAY['groupId','supplierId']
        OR patch-ARRAY['name','price','cost','groupId','supplierId']<>'{}'::jsonb OR jsonb_typeof(expected_values) IS DISTINCT FROM 'object'
        OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(patch) key)
            IS DISTINCT FROM (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(expected_values) key) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
    END IF;
    FOR k IN SELECT jsonb_object_keys(patch) LOOP
        IF (k<>'supplierId' OR jsonb_typeof(patch->k) IS DISTINCT FROM 'null') AND jsonb_typeof(patch->k) IS DISTINCT FROM 'string'
            OR (k='name' AND (length(btrim(patch->>k)) NOT BETWEEN 1 AND 200 OR patch->>k ~ '[[:cntrl:]]'))
            OR (k IN ('price','cost') AND patch->>k !~ '^(0|[1-9][0-9]{0,8})$')
            OR (k IN ('groupId','supplierId') AND jsonb_typeof(patch->k)='string' AND patch->>k !~ '^[A-Za-z0-9._:-]{1,100}$')
            OR jsonb_typeof(expected_values->k) NOT IN ('string','null')
            OR (k IN ('price','cost') AND jsonb_typeof(expected_values->k)='string' AND expected_values->>k !~ '^-?[0-9]{1,20}(\.[0-9]{1,20})?$') THEN
            RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_INVALID' USING ERRCODE='22023';
        END IF;
    END LOOP;
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_UNAVAILABLE' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-operation:'||p_operation_id::text,0));
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id FOR UPDATE;
    IF FOUND THEN
        IF q.actor_id<>p_actor_id OR q.store_id<>p_store_id OR q.product_id<>p_product_id OR q.patch IS DISTINCT FROM patch
            OR q.catalog_snapshot_id IS DISTINCT FROM p_catalog_snapshot_id
            OR NOT private.pos_product_edit_intake_values_match(expected_values-ARRAY['groupId','supplierId'],q.baseline)
            OR (patch ? 'groupId' AND expected_values->'groupId' IS DISTINCT FROM q.pos_choice_baseline->'groupId')
            OR (patch ? 'supplierId' AND expected_values->'supplierId' IS DISTINCT FROM q.pos_choice_baseline->'supplierId') THEN
            RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
        END IF;
        RETURN private.pos_product_edit_intake_json(q);
    END IF;
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE id=p_operation_id)
        OR EXISTS(SELECT 1 FROM public.pos_product_operation_cancellations WHERE operation_id=p_operation_id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='22023';
    END IF;
    SELECT * INTO p FROM public.products WHERE id=p_product_id AND store_id=p_store_id FOR UPDATE;
    IF NOT FOUND OR p.jan_code IS NULL OR p.jan_code !~ '^(\d{8}|\d{12}|\d{13})$' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_UNAVAILABLE' USING ERRCODE='22023';
    END IF;
    SELECT * INTO s FROM public.pos_product_classification_snapshots WHERE snapshot_id=p_catalog_snapshot_id
        AND store_id=p_store_id AND product_id=p_product_id AND jan_code=p.jan_code;
    now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    IF NOT FOUND OR s.expires_at<=now_ms THEN RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001'; END IF;
    baseline:=jsonb_build_object('groupId',s.current_group_id,'supplierId',s.current_supplier_id,
        'groupName',(SELECT g->>'name' FROM jsonb_array_elements(s.groups) g WHERE g->>'id'=s.current_group_id),
        'supplierName',(SELECT supplier->>'name' FROM jsonb_array_elements(s.suppliers) supplier WHERE supplier->>'id'=s.current_supplier_id));
    IF NOT private.pos_product_edit_intake_values_match(expected_values-ARRAY['groupId','supplierId'],private.pos_product_edit_values(p))
        OR (patch ? 'groupId' AND expected_values->'groupId' IS DISTINCT FROM baseline->'groupId')
        OR (patch ? 'supplierId' AND expected_values->'supplierId' IS DISTINCT FROM baseline->'supplierId') THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
    END IF;
    FOR k IN SELECT key FROM jsonb_object_keys(patch) key WHERE key IN ('groupId','supplierId') LOOP
        choices:=CASE k WHEN 'groupId' THEN s.groups ELSE s.suppliers END;
        IF patch->k<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(choices) item WHERE item->'id'=patch->k) THEN
            RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
        END IF;
        requested:=requested||jsonb_build_object(k,CASE WHEN patch->k='null'::jsonb THEN 'null'::jsonb
            ELSE (SELECT item FROM jsonb_array_elements(choices) item WHERE item->'id'=patch->k) END);
    END LOOP;
    baseline:=baseline||jsonb_build_object('requested',requested);
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE store_id=p_store_id
        AND (product_id_snapshot=p.id OR jan_code=p.jan_code) AND status NOT IN ('completed','rejected','not_sent')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_BUSY' USING ERRCODE='55P03';
    END IF;
    -- snapshot期限は商品ロック待機後の時刻で判定する。固定証拠は処理待ち中に更新しない。
    IF s.expires_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint THEN
        RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
    END IF;
    BEGIN
        INSERT INTO public.pos_product_edit_intakes(operation_id,actor_id,store_id,product_id,jan_code,patch,baseline,catalog_snapshot_id,pos_choice_baseline)
            VALUES(p_operation_id,p_actor_id,p_store_id,p.id,p.jan_code,patch,private.pos_product_edit_values(p),s.snapshot_id,baseline) RETURNING * INTO q;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_BUSY' USING ERRCODE='55P03'; END;
    UPDATE public.product_master_store_versions SET revision=revision+1 WHERE store_id=p_store_id;
    RETURN private.pos_product_edit_intake_json(q);
END $$;

CREATE OR REPLACE FUNCTION public.prepare_pos_product_edit_intake(p_operation_id uuid,p_lease_token uuid,p_command_text text,p_pos_product_id text,
    p_expected_result_fingerprint text,p_catalog_text text,p_dispatch_text text,p_before_fingerprint_text text,
    p_expected_fingerprint_text text,p_reviewed_at bigint,p_dispatch_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; op public.pos_product_operations; p public.products; saved jsonb; claimed jsonb;
    c jsonb; b jsonb; edited_before jsonb; s public.pos_product_classification_snapshots; d jsonb; k text; previous_id jsonb; target_id jsonb;
    cached_choices jsonb; fresh_choices jsonb; cached_name jsonb; fresh_name jsonb;
BEGIN
    q:=private.lock_pos_product_edit_intake(p_operation_id,p_lease_token);
    IF q.status<>'working' OR q.lease_expires_at<=clock_timestamp() THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_LEASE_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM private.assert_pos_product_manager(q.actor_id,q.store_id);
    SELECT * INTO op FROM public.pos_product_operations WHERE id=q.operation_id FOR UPDATE;
    IF FOUND AND op.send_attempts=1 THEN
        saved:=public.get_pos_product_edit_dispatch(q.actor_id,q.store_id,q.operation_id);
        RETURN jsonb_build_object('operation',saved->'operation','dispatch',saved->'dispatch','claimed',false);
    END IF;
    c:=private.validate_pos_product_command(p_command_text);
    b:=private.pos_product_dispatch_json(p_before_fingerprint_text);
    IF c->>'kind'<>'update' OR c->>'operationId' IS DISTINCT FROM q.operation_id::text OR c->'storeId' IS DISTINCT FROM to_jsonb(q.store_id)
        OR c->'productId' IS DISTINCT FROM to_jsonb(q.product_id) OR b->>'janCode' IS DISTINCT FROM q.jan_code
        OR c->'fields' IS DISTINCT FROM ((b->'fields')||q.patch)
        OR p_dispatch_hash IS NULL OR p_dispatch_hash IS DISTINCT FROM encode(sha256(convert_to(p_dispatch_text,'UTF8')),'hex') THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='22023';
    END IF;
    SELECT * INTO p FROM public.products WHERE id=q.product_id AND store_id=q.store_id AND jan_code=q.jan_code FOR UPDATE;
    IF NOT FOUND OR private.pos_product_edit_values(p) IS DISTINCT FROM q.baseline THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='40001';
    END IF;
    SELECT coalesce(jsonb_object_agg(key,b->'fields'->key),'{}'::jsonb) INTO edited_before FROM jsonb_object_keys(q.patch) key
        WHERE key NOT IN ('groupId','supplierId');
    IF NOT private.pos_product_edit_intake_values_match(edited_before,q.baseline) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='40001';
    END IF;
    IF q.catalog_snapshot_id IS NOT NULL THEN
        SELECT * INTO s FROM public.pos_product_classification_snapshots WHERE snapshot_id=q.catalog_snapshot_id
            AND store_id=q.store_id AND product_id=q.product_id AND jan_code=q.jan_code;
        IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001'; END IF;
        d:=private.pos_product_dispatch_json(p_dispatch_text);
        BEGIN
            PERFORM private.validate_pos_product_classification_choices(d->'before'->'groups');
            PERFORM private.validate_pos_product_classification_choices(d->'before'->'suppliers');
        EXCEPTION WHEN SQLSTATE '22023' THEN
            RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
        END;
        FOR k IN SELECT key FROM jsonb_object_keys(q.patch) key WHERE key IN ('groupId','supplierId') LOOP
            previous_id:=q.pos_choice_baseline->k; target_id:=q.patch->k;
            cached_choices:=CASE k WHEN 'groupId' THEN s.groups ELSE s.suppliers END;
            fresh_choices:=CASE k WHEN 'groupId' THEN d->'before'->'groups' ELSE d->'before'->'suppliers' END;
            IF b->'fields'->k IS DISTINCT FROM previous_id OR d->'before'->'fields'->k IS DISTINCT FROM previous_id THEN
                RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
            END IF;
            -- 元の選択と希望の選択の双方でID/表示名を固定。null解除は希望値だけに明示可能。
            FOR previous_id IN SELECT value FROM (VALUES(q.pos_choice_baseline->k),(target_id)) selected(value) LOOP
                IF previous_id='null'::jsonb THEN CONTINUE; END IF;
                SELECT item->'name' INTO cached_name FROM jsonb_array_elements(cached_choices) item WHERE item->'id'=previous_id;
                SELECT item->'name' INTO fresh_name FROM jsonb_array_elements(fresh_choices) item WHERE item->'id'=previous_id;
                IF cached_name IS NULL OR fresh_name IS DISTINCT FROM cached_name THEN
                    RAISE EXCEPTION 'POS_PRODUCT_CLASSIFICATION_CONFLICT' USING ERRCODE='40001';
                END IF;
            END LOOP;
        END LOOP;
    END IF;
    UPDATE public.pos_product_edit_intakes SET bridge_in_progress=true WHERE operation_id=q.operation_id;
    op:=jsonb_populate_record(NULL::public.pos_product_operations,
        public.prepare_pos_product_edit(q.actor_id,p_command_text,p_pos_product_id,p_expected_result_fingerprint,p_catalog_text));
    saved:=public.register_pos_product_edit_dispatch(q.actor_id,q.store_id,op.id,op.payload_hash,op.row_version,
        p_dispatch_text,p_before_fingerprint_text,p_expected_fingerprint_text,p_reviewed_at);
    claimed:=public.claim_pos_product_operation(q.actor_id,q.store_id,op.id,op.payload_hash,op.row_version);
    UPDATE public.pos_product_edit_intakes SET bridge_in_progress=false WHERE operation_id=q.operation_id;
    RETURN jsonb_build_object('operation',claimed->'operation','dispatch',saved->'dispatch','claimed',claimed->'claimed');
END $$;

REVOKE ALL ON FUNCTION private.validate_pos_product_classification_choices(jsonb),
    private.pos_product_classification_snapshot_json(public.pos_product_classification_snapshots) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_pos_product_classification_snapshot(uuid,integer,integer,uuid,text),
    public.get_pos_product_classification_snapshot(uuid,integer,integer),
    public.enqueue_pos_product_edit_intake_v2(uuid,integer,integer,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_pos_product_classification_snapshot(uuid,integer,integer,uuid,text),
    public.get_pos_product_classification_snapshot(uuid,integer,integer),
    public.enqueue_pos_product_edit_intake_v2(uuid,integer,integer,uuid,text,text,uuid) TO service_role;
COMMIT;
