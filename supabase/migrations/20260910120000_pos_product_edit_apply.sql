-- 通常編集のPOS確認後反映。create/JAN訂正/削除はこのRPCでは扱わない。本番未適用。
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE kind='update' AND status NOT IN ('completed','rejected')) THEN
        RAISE EXCEPTION 'resolve existing edit operations before migration';
    END IF;
END $$;
CREATE TABLE public.pos_product_edit_intents (
    operation_id uuid PRIMARY KEY,
    store_id integer NOT NULL,
    baseline jsonb NOT NULL,
    catalog jsonb NOT NULL,
    FOREIGN KEY(operation_id,store_id) REFERENCES public.pos_product_operations(id,store_id) ON DELETE RESTRICT
);
CREATE TABLE public.pos_product_edit_receipts (
    operation_id uuid PRIMARY KEY,
    store_id integer NOT NULL,
    before_values jsonb NOT NULL,
    after_values jsonb NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(operation_id,store_id) REFERENCES public.pos_product_operations(id,store_id) ON DELETE RESTRICT
);
-- 対象POS会社は現行アプリの一社に限定。複数会社対応時は会社IDを含むキーへ別移行する。
CREATE TABLE public.pos_product_links (
    product_id integer PRIMARY KEY,
    store_id integer NOT NULL CHECK(store_id IN (6,7)),
    jan_code text NOT NULL,
    pos_product_id text NOT NULL UNIQUE CHECK(pos_product_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
    verified_fingerprint text NOT NULL CHECK(verified_fingerprint ~ '^[0-9a-f]{64}$'),
    verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(product_id,store_id,jan_code) REFERENCES public.products(id,store_id,jan_code) ON DELETE RESTRICT
);
ALTER TABLE public.pos_product_edit_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_edit_intents,public.pos_product_edit_receipts,public.pos_product_links FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_edit_intent_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_intents
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_intent_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_intents
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_receipt_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_receipts
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_receipt_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_receipts
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

-- 同じPOS実体への両店舗からの同時保存も予約で拒否する。
ALTER TABLE public.pos_product_operation_locks DROP CONSTRAINT pos_product_operation_locks_resource_key_check;
ALTER TABLE public.pos_product_operation_locks ADD CONSTRAINT pos_product_operation_locks_resource_key_check
    CHECK(resource_key ~ '^(jan:[0-9]{8,13}|product:[0-9]+|pos:[A-Za-z0-9._:-]{1,128})$');
CREATE UNIQUE INDEX pos_product_operation_pos_identity_unique ON public.pos_product_operation_locks(resource_key)
    WHERE resource_key LIKE 'pos:%';

CREATE FUNCTION private.pos_product_edit_values(p public.products) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
    SELECT jsonb_build_object('product_name',p.product_name,'category',p.category,'product_group',p.product_group,
        'selling_price',p.selling_price,'cost_price',p.cost_price,'supplier_name',p.supplier_name)
$$;

CREATE FUNCTION public.prepare_pos_product_edit(p_actor_id uuid,p_command_text text,p_pos_product_id text,
    p_expected_result_fingerprint text,p_catalog_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb; c jsonb; op public.pos_product_operations; p public.products; i public.pos_product_edit_intents; k text;
BEGIN
    v := private.validate_pos_product_command(p_command_text);
    IF v->>'kind'<>'update' THEN RAISE EXCEPTION 'edit only' USING ERRCODE='22023'; END IF;
    PERFORM private.assert_pos_product_manager(p_actor_id,(v->>'storeId')::integer);
    IF p_catalog_text IS NULL OR octet_length(p_catalog_text)>8000 THEN RAISE EXCEPTION 'invalid catalog' USING ERRCODE='22023'; END IF;
    c := p_catalog_text::jsonb;
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT c ?& ARRAY['groupId','groupName','supplierId','supplierName','previousPosName']
        OR c-ARRAY['groupId','groupName','supplierId','supplierName','previousPosName']<>'{}'::jsonb
        OR c->'groupId' IS DISTINCT FROM v->'fields'->'groupId' OR c->'supplierId' IS DISTINCT FROM v->'fields'->'supplierId'
        OR v->'fields'->>'price' !~ '^\d{1,9}$' OR v->'fields'->>'cost' !~ '^\d{1,9}$' THEN
        RAISE EXCEPTION 'invalid catalog' USING ERRCODE='22023';
    END IF;
    FOREACH k IN ARRAY ARRAY['groupName','previousPosName','supplierName'] LOOP
        IF k='supplierName' AND c->'supplierId'='null'::jsonb THEN
            IF c->k<>'null'::jsonb THEN RAISE EXCEPTION 'invalid catalog' USING ERRCODE='22023'; END IF;
        ELSIF jsonb_typeof(c->k) IS DISTINCT FROM 'string' OR length(btrim(c->>k)) NOT BETWEEN 1 AND 1000 OR c->>k ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'invalid catalog' USING ERRCODE='22023';
        END IF;
    END LOOP;
    -- 同期と共通のロック順。受付再送で現在のDB値を新しい基準に置き換えない。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=(v->>'storeId')::integer FOR UPDATE;
    SELECT * INTO op FROM public.pos_product_operations WHERE id=(v->>'operationId')::uuid;
    IF FOUND THEN
        SELECT * INTO i FROM public.pos_product_edit_intents WHERE operation_id=op.id;
        IF NOT FOUND OR i.catalog IS DISTINCT FROM c THEN RAISE EXCEPTION 'edit intent conflict' USING ERRCODE='22023'; END IF;
        RETURN public.prepare_pos_product_operation(p_actor_id,p_command_text,p_pos_product_id,p_expected_result_fingerprint);
    END IF;
    SELECT * INTO p FROM public.products WHERE id=(v->>'productId')::integer AND store_id=(v->>'storeId')::integer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'product unavailable' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.pos_product_links l WHERE (l.pos_product_id=p_pos_product_id OR l.product_id=p.id)
        AND (l.product_id<>p.id OR l.store_id<>p.store_id OR l.jan_code<>p.jan_code OR l.pos_product_id<>p_pos_product_id)) THEN
        RAISE EXCEPTION 'POS identity conflict' USING ERRCODE='22023';
    END IF;
    op := jsonb_populate_record(NULL::public.pos_product_operations,
        public.prepare_pos_product_operation(p_actor_id,p_command_text,p_pos_product_id,p_expected_result_fingerprint));
    INSERT INTO public.pos_product_operation_locks(store_id,resource_key,operation_id) VALUES(op.store_id,'pos:'||op.pos_product_id,op.id);
    INSERT INTO public.pos_product_edit_intents(operation_id,store_id,baseline,catalog)
        VALUES(op.id,op.store_id,private.pos_product_edit_values(p),c);
    RETURN to_jsonb(op);
END $$;

CREATE FUNCTION public.apply_pos_product_edit(p_actor_id uuid,p_store_id integer,p_operation_id uuid,p_payload_hash text,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; i public.pos_product_edit_intents; p public.products;
    f jsonb; expected jsonb; old_name text; a public.product_aliases;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    op := private.lock_pos_product_operation(p_actor_id,p_store_id,p_operation_id,p_payload_hash);
    IF op.kind<>'update' THEN RAISE EXCEPTION 'edit only' USING ERRCODE='22023'; END IF;
    SELECT * INTO i FROM public.pos_product_edit_intents WHERE operation_id=op.id AND store_id=op.store_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'edit intent unavailable' USING ERRCODE='22023'; END IF;
    IF op.status='completed' AND EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=op.id AND store_id=op.store_id) THEN
        RETURN to_jsonb(op);
    END IF;
    IF op.row_version IS DISTINCT FROM p_expected_version OR op.status NOT IN ('pos_confirmed','db_pending')
        OR op.verified_fingerprint IS DISTINCT FROM op.expected_result_fingerprint THEN
        RAISE EXCEPTION 'edit is not verified or version changed' USING ERRCODE='40001';
    END IF;
    IF (SELECT count(*) FROM public.pos_product_operation_locks WHERE operation_id=op.id AND store_id=op.store_id
        AND resource_key IN ('jan:'||op.jan_code,'product:'||op.product_id_snapshot,'pos:'||op.pos_product_id))<>3 THEN
        RAISE EXCEPTION 'edit reservations unavailable' USING ERRCODE='22023';
    END IF;
    SELECT * INTO p FROM public.products WHERE id=op.product_id_snapshot AND store_id=op.store_id AND jan_code=op.jan_code FOR UPDATE;
    IF NOT FOUND OR private.pos_product_edit_values(p) IS DISTINCT FROM i.baseline THEN
        RAISE EXCEPTION 'local product changed' USING ERRCODE='40001';
    END IF;
    f := op.command_text::jsonb->'fields';
    -- 新名称の既存別名によって売上が別商品へ解決されるケースも拒否する。
    PERFORM 1 FROM public.product_aliases WHERE alias_name=f->>'name' AND source_system='pos' AND store_id=op.store_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.product_aliases WHERE alias_name=f->>'name' AND source_system='pos' AND store_id=op.store_id
        AND (product_id<>p.id OR is_active IS DISTINCT FROM true)) THEN
        RAISE EXCEPTION 'new name alias conflict' USING ERRCODE='23505';
    END IF;
    expected := jsonb_build_object('product_name',f->>'name','category',i.catalog->>'groupName','product_group',i.catalog->>'groupName',
        'selling_price',(f->>'price')::numeric,'cost_price',(f->>'cost')::numeric,'supplier_name',i.catalog->>'supplierName');
    -- 旧DB名と旧POS名の売上照合を保護。他商品や意図的に停止した別名を奪わない。
    FOR old_name IN SELECT DISTINCT n FROM unnest(ARRAY[p.product_name,i.catalog->>'previousPosName']) n
        WHERE n IS NOT NULL AND btrim(n)<>'' AND n<>f->>'name' LOOP
        IF EXISTS(SELECT 1 FROM public.products WHERE store_id=op.store_id AND id<>p.id AND product_name=old_name) THEN
            RAISE EXCEPTION 'alias name conflict' USING ERRCODE='23505';
        END IF;
        INSERT INTO public.product_aliases(alias_name,product_id,source_system,is_active,store_id)
            VALUES(old_name,p.id,'pos',true,op.store_id) ON CONFLICT(alias_name,source_system,store_id) DO NOTHING;
        SELECT * INTO a FROM public.product_aliases WHERE alias_name=old_name AND source_system='pos' AND store_id=op.store_id FOR UPDATE;
        IF NOT FOUND OR a.product_id<>p.id OR a.is_active IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'alias conflict' USING ERRCODE='23505';
        END IF;
    END LOOP;
    UPDATE public.products SET product_name=f->>'name',category=i.catalog->>'groupName',product_group=i.catalog->>'groupName',
        selling_price=(f->>'price')::numeric,cost_price=(f->>'cost')::numeric,supplier_name=i.catalog->>'supplierName',
        markup_rate=CASE WHEN (f->>'price')::numeric>0 THEN round(((f->>'price')::numeric-(f->>'cost')::numeric)/(f->>'price')::numeric,4) ELSE 0 END,
        updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
    IF private.pos_product_edit_values(p) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'product apply mismatch' USING ERRCODE='22023'; END IF;
    INSERT INTO public.pos_product_links(product_id,store_id,jan_code,pos_product_id,verified_fingerprint)
        VALUES(p.id,p.store_id,p.jan_code,op.pos_product_id,op.verified_fingerprint)
        ON CONFLICT(product_id) DO UPDATE SET verified_fingerprint=EXCLUDED.verified_fingerprint,verified_at=clock_timestamp()
        WHERE pos_product_links.store_id=EXCLUDED.store_id AND pos_product_links.jan_code=EXCLUDED.jan_code AND pos_product_links.pos_product_id=EXCLUDED.pos_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS identity conflict' USING ERRCODE='22023'; END IF;
    INSERT INTO public.pos_product_edit_receipts(operation_id,store_id,before_values,after_values) VALUES(op.id,op.store_id,i.baseline,expected);
    UPDATE public.pos_product_operations SET status='completed',row_version=row_version+1,last_event='db_completed' WHERE id=op.id RETURNING * INTO op;
    DELETE FROM public.pos_product_operation_locks WHERE operation_id=op.id;
    RETURN to_jsonb(op);
END $$;

REVOKE ALL ON FUNCTION private.pos_product_edit_values(public.products) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_pos_product_edit(uuid,text,text,text,text),public.apply_pos_product_edit(uuid,integer,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_pos_product_edit(uuid,text,text,text,text),public.apply_pos_product_edit(uuid,integer,uuid,text,bigint) TO service_role;

-- 既存の遷移制約を維持し、商品反映記録が同transactionにある場合だけ完了を許可する。
CREATE OR REPLACE FUNCTION private.guard_pos_product_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status<>'prepared' OR NEW.row_version<>0 OR NEW.last_event<>'prepared' THEN
            RAISE EXCEPTION 'invalid initial operation' USING ERRCODE='22023';
        END IF;
        IF NEW.kind='update' AND NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=NEW.product_id_snapshot
            AND p.store_id=NEW.store_id AND p.jan_code=NEW.jan_code) THEN
            RAISE EXCEPTION 'product unavailable' USING ERRCODE='23514';
        END IF;
    ELSE
        IF (to_jsonb(NEW)-ARRAY['status','send_attempts','row_version','last_event','updated_at','verified_fingerprint'])
            IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','send_attempts','row_version','last_event','updated_at','verified_fingerprint'])
            OR NEW.row_version<>OLD.row_version+1 THEN
            RAISE EXCEPTION 'operation identity is immutable' USING ERRCODE='22023';
        END IF;
        IF NEW.kind='update' AND NEW.status='dispatching' AND (
            NOT EXISTS(SELECT 1 FROM public.pos_product_edit_intents WHERE operation_id=NEW.id AND store_id=NEW.store_id)
            OR NOT EXISTS(SELECT 1 FROM public.pos_product_operation_locks WHERE operation_id=NEW.id AND resource_key='pos:'||NEW.pos_product_id)
        ) THEN RAISE EXCEPTION 'edit intent unavailable' USING ERRCODE='22023'; END IF;
        IF NOT (
            (OLD.status='prepared' AND NEW.status='dispatching' AND NEW.last_event='claim_dispatch')
            OR (OLD.status='prepared' AND NEW.status='rejected' AND NEW.last_event='reject_before_dispatch')
            OR (OLD.status='dispatching' AND NEW.status='verifying' AND NEW.last_event='dispatch_returned')
            OR (OLD.status IN ('dispatching','verifying','uncertain') AND NEW.status='uncertain' AND NEW.last_event='outcome_unknown')
            OR (OLD.status IN ('verifying','uncertain') AND NEW.status='pos_confirmed' AND NEW.last_event='pos_verified')
            OR (OLD.status IN ('pos_confirmed','db_pending') AND NEW.status='db_pending' AND NEW.last_event='db_failed')
            OR (OLD.status IN ('pos_confirmed','db_pending') AND NEW.status='completed' AND NEW.last_event='db_completed'
                AND NEW.kind='update' AND EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=NEW.id AND store_id=NEW.store_id))
        ) THEN RAISE EXCEPTION 'invalid transition' USING ERRCODE='22023'; END IF;
        NEW.updated_at := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
