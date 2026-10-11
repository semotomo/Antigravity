-- 未照合の変更入力だけを永続受付する。確定商品・棚卸し数量・既存POS監査は変更しない。
CREATE TABLE public.pos_product_edit_intakes (
    operation_id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    store_id integer NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT CHECK(store_id IN (6,7)),
    product_id integer NOT NULL CHECK(product_id>0),
    jan_code text NOT NULL CHECK(jan_code ~ '^(\d{8}|\d{12}|\d{13})$'),
    patch jsonb NOT NULL CHECK(jsonb_typeof(patch)='object' AND patch<>'{}'::jsonb AND patch-ARRAY['name','price','cost']='{}'::jsonb),
    baseline jsonb NOT NULL CHECK(jsonb_typeof(baseline)='object'),
    status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','working','needs_review','completed','cancelled')),
    worker_id uuid,
    lease_token uuid,
    lease_expires_at timestamptz,
    code text CHECK(code IN ('POS_PRODUCT_EDIT_CONFLICT','POS_PRODUCT_EDIT_ACCESS_REVOKED','POS_PRODUCT_EDIT_INSPECTION_FAILED',
        'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN','POS_PRODUCT_EDIT_NOT_SENT','POS_PRODUCT_EDIT_DISABLED','POS_PRODUCT_EDIT_REJECTED','POS_PRODUCT_EDIT_LEASE_EXPIRED')),
    -- 書込み権限のないservice呼出側から設定できない、bridge transaction内部だけの通行権。
    bridge_in_progress boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK((worker_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK(status<>'queued' OR (lease_token IS NULL AND code IS NULL)),
    CHECK(status<>'working' OR (lease_token IS NOT NULL AND code IS NULL)),
    CHECK(status<>'needs_review' OR code IS NOT NULL),
    UNIQUE(operation_id,store_id)
);
CREATE UNIQUE INDEX pos_product_edit_intake_active_product ON public.pos_product_edit_intakes(store_id,product_id)
    WHERE status IN ('queued','working','needs_review');
CREATE UNIQUE INDEX pos_product_edit_intake_active_jan ON public.pos_product_edit_intakes(store_id,jan_code)
    WHERE status IN ('queued','working','needs_review');
CREATE INDEX pos_product_edit_intake_claim ON public.pos_product_edit_intakes(store_id,created_at)
    WHERE status IN ('queued','working');
-- 空キュー時も要求IDを記録する。lease所有者が変わっても旧claimの再配送権を復活させない。
CREATE TABLE private.pos_product_edit_intake_claim_receipts (
    store_id integer NOT NULL REFERENCES public.stores(id) CHECK(store_id IN (6,7)),
    worker_id uuid NOT NULL,
    operation_id uuid REFERENCES public.pos_product_edit_intakes(operation_id) ON DELETE RESTRICT,
    claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(store_id,worker_id)
);
REVOKE ALL ON private.pos_product_edit_intake_claim_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_product_intake_claim_receipt_immutable BEFORE UPDATE OR DELETE ON private.pos_product_edit_intake_claim_receipts
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_intake_claim_receipt_no_truncate BEFORE TRUNCATE ON private.pos_product_edit_intake_claim_receipts
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TABLE public.pos_product_edit_intake_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id uuid NOT NULL,
    store_id integer NOT NULL,
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    previous_status text,
    new_status text NOT NULL,
    code text,
    worker_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(operation_id,store_id) REFERENCES public.pos_product_edit_intakes(operation_id,store_id) ON DELETE RESTRICT
);
ALTER TABLE public.pos_product_edit_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_intakes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_intake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_intake_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_edit_intakes,public.pos_product_edit_intake_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.pos_product_edit_intake_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pos_product_edit_intakes,public.pos_product_edit_intake_events TO authenticated;
CREATE POLICY pos_product_intake_manager_read ON public.pos_product_edit_intakes FOR SELECT TO authenticated
    USING(private.can_access_store(store_id,ARRAY['manager']::text[]));
CREATE POLICY pos_product_intake_event_manager_read ON public.pos_product_edit_intake_events FOR SELECT TO authenticated
    USING(private.can_access_store(store_id,ARRAY['manager']::text[]));

CREATE FUNCTION private.guard_pos_product_edit_intake() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status<>'queued' OR NEW.lease_token IS NOT NULL OR NEW.bridge_in_progress OR NEW.code IS NOT NULL THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
        END IF;
    ELSE
        IF (to_jsonb(NEW)-ARRAY['status','worker_id','lease_token','lease_expires_at','code','bridge_in_progress','updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','worker_id','lease_token','lease_expires_at','code','bridge_in_progress','updated_at'])
            OR (OLD.status IN ('completed','cancelled') AND to_jsonb(NEW)-'updated_at' IS DISTINCT FROM to_jsonb(OLD)-'updated_at') THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_IMMUTABLE' USING ERRCODE='22023';
        END IF;
        NEW.updated_at:=clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION private.audit_pos_product_edit_intake() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    -- bridge内部の一時フラグだけの変更で履歴を水増ししない。
    IF TG_OP='INSERT' OR (to_jsonb(NEW)-ARRAY['bridge_in_progress','updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['bridge_in_progress','updated_at']) THEN
        INSERT INTO public.pos_product_edit_intake_events(operation_id,store_id,actor_id,previous_status,new_status,code,worker_id)
            VALUES(NEW.operation_id,NEW.store_id,NEW.actor_id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,NEW.code,NEW.worker_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER pos_product_intake_guard BEFORE INSERT OR UPDATE ON public.pos_product_edit_intakes
    FOR EACH ROW EXECUTE FUNCTION private.guard_pos_product_edit_intake();
CREATE TRIGGER pos_product_intake_audit AFTER INSERT OR UPDATE ON public.pos_product_edit_intakes
    FOR EACH ROW EXECUTE FUNCTION private.audit_pos_product_edit_intake();
CREATE TRIGGER pos_product_intake_no_delete BEFORE DELETE ON public.pos_product_edit_intakes
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_intake_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_intakes
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_intake_event_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_intake_events
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_intake_event_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_intake_events
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

CREATE FUNCTION private.pos_product_edit_intake_json(q public.pos_product_edit_intakes) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT to_jsonb(q)-'bridge_in_progress' $$;
CREATE FUNCTION private.pos_product_edit_intake_values_match(p_values jsonb,p_baseline jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; observed text; expected text;
BEGIN
    FOR k IN SELECT jsonb_object_keys(p_values) LOOP
        observed:=p_values->>k;
        expected:=CASE k WHEN 'name' THEN p_baseline->>'product_name' WHEN 'price' THEN p_baseline->>'selling_price' ELSE p_baseline->>'cost_price' END;
        IF k='name' THEN
            IF observed IS DISTINCT FROM expected THEN RETURN false; END IF;
        ELSE
            -- 表示上の126.00とDBの126は同じ金額。非数値を例外や暗黙の0に変えない。
            IF observed IS NULL OR expected IS NULL THEN
                IF observed IS DISTINCT FROM expected THEN RETURN false; END IF;
            ELSIF observed !~ '^-?[0-9]{1,20}(\.[0-9]{1,20})?$' OR expected !~ '^-?[0-9]{1,20}(\.[0-9]{1,20})?$'
                OR observed::numeric IS DISTINCT FROM expected::numeric THEN RETURN false;
            END IF;
        END IF;
    END LOOP;
    RETURN true;
END $$;
CREATE FUNCTION public.enqueue_pos_product_edit_intake(p_actor_id uuid,p_store_id integer,p_product_id integer,p_operation_id uuid,
    p_patch_text text,p_expected_values_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; p public.products; patch jsonb; expected_values jsonb; k text;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_operation_id IS NULL OR p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_product_id IS NULL OR p_product_id<=0 OR p_patch_text IS NULL OR octet_length(p_patch_text) NOT BETWEEN 1 AND 4096
        OR p_expected_values_text IS NULL OR octet_length(p_expected_values_text) NOT BETWEEN 1 AND 4096 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
    END IF;
    BEGIN
        patch:=private.pos_product_dispatch_json(p_patch_text);
        expected_values:=private.pos_product_dispatch_json(p_expected_values_text);
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '22P02' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
    END;
    IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR patch='{}'::jsonb OR patch-ARRAY['name','price','cost']<>'{}'::jsonb
        OR jsonb_typeof(expected_values) IS DISTINCT FROM 'object'
        OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(patch) key)
            IS DISTINCT FROM (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(expected_values) key) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
    END IF;
    FOR k IN SELECT jsonb_object_keys(patch) LOOP
        IF jsonb_typeof(patch->k) IS DISTINCT FROM 'string' OR
            (k='name' AND (length(btrim(patch->>k)) NOT BETWEEN 1 AND 200 OR patch->>k ~ '[[:cntrl:]]')) OR
            (k IN ('price','cost') AND patch->>k !~ '^(0|[1-9][0-9]{0,8})$') THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
        END IF;
        IF jsonb_typeof(expected_values->k) NOT IN ('string','null') OR
            (k IN ('price','cost') AND jsonb_typeof(expected_values->k)='string'
                AND expected_values->>k !~ '^-?[0-9]{1,20}(\.[0-9]{1,20})?$') THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
        END IF;
    END LOOP;
    -- 同期/bridge/取消と同じ店舗→操作ID→受付→商品の順で排他する。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_UNAVAILABLE' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-operation:'||p_operation_id::text,0));
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id FOR UPDATE;
    IF FOUND THEN
        IF q.actor_id<>p_actor_id OR q.store_id<>p_store_id OR q.product_id<>p_product_id OR q.patch IS DISTINCT FROM patch
            OR NOT private.pos_product_edit_intake_values_match(expected_values,q.baseline) THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='22023';
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
    IF NOT private.pos_product_edit_intake_values_match(expected_values,private.pos_product_edit_values(p)) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='40001';
    END IF;
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE store_id=p_store_id
        AND (product_id_snapshot=p.id OR jan_code=p.jan_code) AND status NOT IN ('completed','rejected','not_sent')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_BUSY' USING ERRCODE='55P03';
    END IF;
    BEGIN
        INSERT INTO public.pos_product_edit_intakes(operation_id,actor_id,store_id,product_id,jan_code,patch,baseline)
            VALUES(p_operation_id,p_actor_id,p_store_id,p.id,p.jan_code,patch,private.pos_product_edit_values(p)) RETURNING * INTO q;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_BUSY' USING ERRCODE='55P03'; END;
    -- 取消後も受付以前のCSVは古い。確定商品を変更せず店舗版だけを進める。
    UPDATE public.product_master_store_versions SET revision=revision+1 WHERE store_id=p_store_id;
    RETURN private.pos_product_edit_intake_json(q);
END $$;

CREATE FUNCTION public.get_pos_product_edit_intakes(p_actor_id uuid,p_store_id integer,p_product_ids integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_product_ids IS NOT NULL AND (cardinality(p_product_ids)>100 OR array_ndims(p_product_ids)>1
        OR EXISTS(SELECT 1 FROM unnest(p_product_ids) id WHERE id IS NULL OR id<=0)) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
    END IF;
    -- 終端を一覧から消す前に同じ行で観測できるよう、各商品につき最新受付を一件だけ返す。
    RETURN (WITH latest AS (
        SELECT DISTINCT ON (product_id) operation_id FROM public.pos_product_edit_intakes
            WHERE store_id=p_store_id AND (p_product_ids IS NULL OR product_id=ANY(p_product_ids))
            ORDER BY product_id,created_at DESC,operation_id DESC
    ) SELECT COALESCE(jsonb_agg(private.pos_product_edit_intake_json(q) ORDER BY q.created_at),'[]'::jsonb)
        FROM public.pos_product_edit_intakes q JOIN latest USING(operation_id));
END $$;
CREATE FUNCTION public.get_pos_product_edit_intake(p_actor_id uuid,p_store_id integer,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    RETURN (SELECT private.pos_product_edit_intake_json(q) FROM public.pos_product_edit_intakes q
        WHERE q.operation_id=p_operation_id AND q.actor_id=p_actor_id AND q.store_id=p_store_id);
END $$;

CREATE FUNCTION public.claim_pos_product_edit_intake(p_store_id integer,p_worker_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; op public.pos_product_operations;
BEGIN
    IF p_store_id IS NULL OR p_store_id NOT IN (6,7) OR p_worker_id IS NULL THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM private.pos_product_edit_intake_claim_receipts WHERE store_id=p_store_id AND worker_id=p_worker_id) THEN
        RETURN jsonb_build_object('claimed',false,'intake',NULL,'operation',NULL);
    END IF;
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE store_id=p_store_id
        AND (status='queued' OR (status='working' AND lease_expires_at<=clock_timestamp())) ORDER BY created_at,operation_id
        FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO private.pos_product_edit_intake_claim_receipts(store_id,worker_id) VALUES(p_store_id,p_worker_id);
        RETURN jsonb_build_object('claimed',false,'intake',NULL,'operation',NULL);
    END IF;
    INSERT INTO private.pos_product_edit_intake_claim_receipts(store_id,worker_id,operation_id) VALUES(p_store_id,p_worker_id,q.operation_id);
    SELECT * INTO op FROM public.pos_product_operations WHERE id=q.operation_id;
    BEGIN
        PERFORM private.assert_pos_product_manager(q.actor_id,q.store_id);
    EXCEPTION WHEN insufficient_privilege THEN
        UPDATE public.pos_product_edit_intakes SET status='needs_review',code='POS_PRODUCT_EDIT_ACCESS_REVOKED',bridge_in_progress=false
            WHERE operation_id=q.operation_id RETURNING * INTO q;
        RETURN jsonb_build_object('claimed',false,'intake',private.pos_product_edit_intake_json(q),
            'operation',CASE WHEN op.id IS NULL THEN NULL ELSE to_jsonb(op) END);
    END;
    -- leaseの再取得は処理所有者だけを変える。既存send_attempts/consumeを巻き戻さない。
    UPDATE public.pos_product_edit_intakes SET status='working',worker_id=p_worker_id,lease_token=gen_random_uuid(),
        lease_expires_at=clock_timestamp()+interval '8 minutes',code=NULL,bridge_in_progress=false
        WHERE operation_id=q.operation_id RETURNING * INTO q;
    RETURN jsonb_build_object('claimed',true,'intake',private.pos_product_edit_intake_json(q),
        'operation',CASE WHEN op.id IS NULL THEN NULL ELSE to_jsonb(op) END);
END $$;

CREATE FUNCTION private.lock_pos_product_edit_intake(p_operation_id uuid,p_lease_token uuid)
RETURNS public.pos_product_edit_intakes LANGUAGE plpgsql SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; target_store integer;
BEGIN
    SELECT store_id INTO target_store FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id;
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=target_store FOR UPDATE;
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id FOR UPDATE;
    IF NOT FOUND OR p_lease_token IS NULL OR q.lease_token IS DISTINCT FROM p_lease_token THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_LEASE_REJECTED' USING ERRCODE='22023';
    END IF;
    RETURN q;
END $$;
CREATE FUNCTION public.get_pos_product_edit_intake_lease(p_operation_id uuid,p_store_id integer,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; saved jsonb;
BEGIN
    q:=private.lock_pos_product_edit_intake(p_operation_id,p_lease_token);
    -- 終端後の同じlease照会はACK消失の復旧に使える。期限切れでも読取りだけで再実行しない。
    IF q.store_id IS DISTINCT FROM p_store_id OR q.status='queued' OR (q.status='working' AND q.lease_expires_at<=clock_timestamp()) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_LEASE_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM private.assert_pos_product_manager(q.actor_id,q.store_id);
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE id=q.operation_id) THEN
        saved:=public.get_pos_product_edit_dispatch(q.actor_id,q.store_id,q.operation_id);
    ELSE saved:=jsonb_build_object('operation',NULL,'dispatch',NULL,'receipt',NULL); END IF;
    RETURN saved||jsonb_build_object('intake',private.pos_product_edit_intake_json(q));
END $$;

-- 通常prepareから受付商品を横取りできない。通行権は書込み不可の受付行内でbridgeだけが設定する。
CREATE FUNCTION private.guard_pos_product_intake_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes;
BEGIN
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=NEW.store_id FOR UPDATE;
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE (operation_id=NEW.id OR
        (store_id=NEW.store_id AND (product_id=NEW.product_id_snapshot OR jan_code=NEW.jan_code)))
        AND status IN ('queued','working','needs_review') FOR UPDATE;
    IF FOUND AND (q.operation_id<>NEW.id OR q.actor_id<>NEW.actor_id OR q.store_id<>NEW.store_id OR q.product_id<>NEW.product_id_snapshot
        OR q.jan_code<>NEW.jan_code OR q.status<>'working' OR NOT q.bridge_in_progress OR q.lease_expires_at<=clock_timestamp()) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_BUSY' USING ERRCODE='55P03';
    END IF;
    -- 終端受付IDも、通常prepareで遅延受付し直すことはできない。
    IF NOT FOUND AND EXISTS(SELECT 1 FROM public.pos_product_edit_intakes WHERE operation_id=NEW.id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_BUSY' USING ERRCODE='55P03';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER pos_product_intake_operation_guard BEFORE INSERT ON public.pos_product_operations
    FOR EACH ROW EXECUTE FUNCTION private.guard_pos_product_intake_operation();

CREATE FUNCTION public.prepare_pos_product_edit_intake(p_operation_id uuid,p_lease_token uuid,p_command_text text,p_pos_product_id text,
    p_expected_result_fingerprint text,p_catalog_text text,p_dispatch_text text,p_before_fingerprint_text text,
    p_expected_fingerprint_text text,p_reviewed_at bigint,p_dispatch_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; op public.pos_product_operations; p public.products; saved jsonb; claimed jsonb;
    c jsonb; b jsonb; edited_before jsonb;
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
    -- 編集した項目だけ、受付時DB値とfresh POS値の競合を検査する。
    SELECT jsonb_object_agg(key,b->'fields'->key) INTO edited_before FROM jsonb_object_keys(q.patch) key;
    IF NOT private.pos_product_edit_intake_values_match(edited_before,q.baseline) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CONFLICT' USING ERRCODE='40001';
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

CREATE FUNCTION public.finish_pos_product_edit_intake(p_operation_id uuid,p_lease_token uuid,p_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; op public.pos_product_operations; next_status text; next_code text;
BEGIN
    q:=private.lock_pos_product_edit_intake(p_operation_id,p_lease_token);
    IF q.status IN ('completed','cancelled') THEN RETURN private.pos_product_edit_intake_json(q); END IF;
    IF q.status NOT IN ('working','needs_review') OR (q.status='working' AND q.lease_expires_at<=clock_timestamp()) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_LEASE_REJECTED' USING ERRCODE='22023';
    END IF;
    IF p_code IS NOT NULL AND p_code NOT IN ('POS_PRODUCT_EDIT_CONFLICT','POS_PRODUCT_EDIT_ACCESS_REVOKED','POS_PRODUCT_EDIT_INSPECTION_FAILED',
        'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN','POS_PRODUCT_EDIT_NOT_SENT','POS_PRODUCT_EDIT_DISABLED','POS_PRODUCT_EDIT_REJECTED','POS_PRODUCT_EDIT_LEASE_EXPIRED') THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_INVALID' USING ERRCODE='22023';
    END IF;
    -- 失効権限の固定通知は保存できるが、通常の完了反映はmanagerを再検査する。
    IF p_code IS DISTINCT FROM 'POS_PRODUCT_EDIT_ACCESS_REVOKED' THEN PERFORM private.assert_pos_product_manager(q.actor_id,q.store_id); END IF;
    SELECT * INTO op FROM public.pos_product_operations WHERE id=q.operation_id FOR UPDATE;
    IF op.status='completed' AND EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=q.operation_id) THEN
        next_status:='completed';next_code:=NULL;
    ELSIF op.status IN ('rejected','not_sent') AND NOT EXISTS(SELECT 1 FROM public.pos_product_operation_locks WHERE operation_id=q.operation_id) THEN
        next_status:='cancelled';next_code:=CASE WHEN op.status='not_sent' THEN 'POS_PRODUCT_EDIT_NOT_SENT' ELSE 'POS_PRODUCT_EDIT_REJECTED' END;
    ELSE
        -- 要確認の再照会だけでは解決扱いにしない。台帳の終端証跡がある場合のみ解除する。
        IF q.status='needs_review' THEN RETURN private.pos_product_edit_intake_json(q); END IF;
        next_status:='needs_review';next_code:=COALESCE(p_code,CASE WHEN op.send_attempts=1 THEN 'POS_PRODUCT_EDIT_OUTCOME_UNKNOWN' ELSE 'POS_PRODUCT_EDIT_INSPECTION_FAILED' END);
    END IF;
    UPDATE public.pos_product_edit_intakes SET status=next_status,code=next_code,bridge_in_progress=false
        WHERE operation_id=q.operation_id RETURNING * INTO q;
    RETURN private.pos_product_edit_intake_json(q);
END $$;
CREATE FUNCTION public.requeue_pos_product_edit_intake(p_actor_id uuid,p_store_id integer,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; op public.pos_product_operations;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id AND actor_id=p_actor_id AND store_id=p_store_id FOR UPDATE;
    IF NOT FOUND OR q.status<>'needs_review' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_REQUEUE_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO op FROM public.pos_product_operations WHERE id=q.operation_id FOR UPDATE;
    IF FOUND THEN
        -- 送信済みは同じoperation/dispatch/consumeを保ち、workerは読取り照合とDB反映だけ行う。
        IF op.send_attempts<>1 OR op.status NOT IN ('dispatching','verifying','uncertain','pos_confirmed','db_pending') THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_REQUEUE_REJECTED' USING ERRCODE='22023';
        END IF;
    ELSIF q.code NOT IN ('POS_PRODUCT_EDIT_INSPECTION_FAILED','POS_PRODUCT_EDIT_DISABLED','POS_PRODUCT_EDIT_LEASE_EXPIRED') THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_REQUEUE_REJECTED' USING ERRCODE='22023';
    END IF;
    UPDATE public.pos_product_edit_intakes SET status='queued',worker_id=NULL,lease_token=NULL,lease_expires_at=NULL,
        code=NULL,bridge_in_progress=false WHERE operation_id=q.operation_id RETURNING * INTO q;
    RETURN private.pos_product_edit_intake_json(q);
END $$;
CREATE FUNCTION public.cancel_pos_product_edit_intake(p_actor_id uuid,p_store_id integer,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.pos_product_edit_intakes; op public.pos_product_operations;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    SELECT * INTO q FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id AND actor_id=p_actor_id AND store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CANCEL_REJECTED' USING ERRCODE='22023'; END IF;
    IF q.status='cancelled' THEN RETURN private.pos_product_edit_intake_json(q); END IF;
    IF q.status='completed' THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CANCEL_REJECTED' USING ERRCODE='22023'; END IF;
    SELECT * INTO op FROM public.pos_product_operations WHERE id=q.operation_id FOR UPDATE;
    IF FOUND THEN
        IF op.status<>'prepared' OR op.send_attempts<>0 THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_CANCEL_REJECTED' USING ERRCODE='22023'; END IF;
        PERFORM public.cancel_pos_product_edit(p_actor_id,p_store_id,q.product_id,q.operation_id);
    END IF;
    UPDATE public.pos_product_edit_intakes SET status='cancelled',bridge_in_progress=false WHERE operation_id=q.operation_id RETURNING * INTO q;
    RETURN private.pos_product_edit_intake_json(q);
END $$;
CREATE FUNCTION public.abandon_pos_product_edit_intake(p_actor_id uuid,p_store_id integer,p_product_id integer,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_product_id IS NULL OR p_product_id<=0 OR p_operation_id IS NULL THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_ABANDON_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 受付と同じ順序で排他し、遅延POSTにも取消を確実に残す。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-operation:'||p_operation_id::text,0));
    IF EXISTS(SELECT 1 FROM public.pos_product_edit_intakes WHERE operation_id=p_operation_id)
        OR EXISTS(SELECT 1 FROM public.pos_product_operations WHERE id=p_operation_id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_ABANDON_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM public.cancel_pos_product_edit(p_actor_id,p_store_id,p_product_id,p_operation_id);
    IF NOT EXISTS(SELECT 1 FROM public.pos_product_operation_cancellations WHERE operation_id=p_operation_id
        AND actor_id=p_actor_id AND store_id=p_store_id AND product_id_snapshot=p_product_id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_ABANDON_REJECTED' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('operationId',p_operation_id,'storeId',p_store_id,'productId',p_product_id,'abandoned',true);
END $$;

-- 旧関数を新migrationだけで拡張する。期待した既知本文でなければ部分適用を拒否する。
DO $intake_fences$
DECLARE target regprocedure; definition text; needle text; replacement text;
BEGIN
    target:='public.prepare_pos_product_operation(uuid,text,text,text)'::regprocedure;
    definition:=pg_get_functiondef(target);
    needle:='    PERFORM private.assert_pos_product_manager(p_actor_id,v_store);';
    IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_FENCE_SOURCE_MISMATCH' USING ERRCODE='55000';
    END IF;
    -- generic prepareも店舗行を最初に取得し、受付/取消/同期とのlock順を合わせる。
    replacement:=needle||E'\n    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=v_store FOR UPDATE;';
    EXECUTE replace(definition,needle,replacement);
    needle:='IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE store_id=p_store_id AND status NOT IN (''completed'',''rejected'',''not_sent'')) THEN';
    replacement:=replace(needle,' THEN',E' OR EXISTS(SELECT 1 FROM public.pos_product_edit_intakes WHERE store_id=p_store_id\n        AND status IN (''queued'',''working'',''needs_review'')) THEN');
    FOR target IN SELECT fn FROM (VALUES('public.begin_product_master_sync(integer)'::regprocedure),
        ('public.apply_product_master_sync(uuid,integer,jsonb)'::regprocedure)) functions(fn) LOOP
        definition:=pg_get_functiondef(target);
        IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_INTAKE_FENCE_SOURCE_MISMATCH' USING ERRCODE='55000';
        END IF;
        EXECUTE replace(definition,needle,replacement);
    END LOOP;
END $intake_fences$;

REVOKE ALL ON FUNCTION private.guard_pos_product_edit_intake(),private.audit_pos_product_edit_intake(),
    private.pos_product_edit_intake_json(public.pos_product_edit_intakes),private.lock_pos_product_edit_intake(uuid,uuid),
    private.pos_product_edit_intake_values_match(jsonb,jsonb),private.guard_pos_product_intake_operation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.enqueue_pos_product_edit_intake(uuid,integer,integer,uuid,text,text),public.get_pos_product_edit_intakes(uuid,integer,integer[]),
    public.get_pos_product_edit_intake(uuid,integer,uuid),public.claim_pos_product_edit_intake(integer,uuid),public.get_pos_product_edit_intake_lease(uuid,integer,uuid),
    public.prepare_pos_product_edit_intake(uuid,uuid,text,text,text,text,text,text,text,bigint,text),
    public.finish_pos_product_edit_intake(uuid,uuid,text),public.cancel_pos_product_edit_intake(uuid,integer,uuid),
    public.requeue_pos_product_edit_intake(uuid,integer,uuid),public.abandon_pos_product_edit_intake(uuid,integer,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_pos_product_edit_intake(uuid,integer,integer,uuid,text,text),public.get_pos_product_edit_intakes(uuid,integer,integer[]),
    public.get_pos_product_edit_intake(uuid,integer,uuid),public.claim_pos_product_edit_intake(integer,uuid),public.get_pos_product_edit_intake_lease(uuid,integer,uuid),
    public.prepare_pos_product_edit_intake(uuid,uuid,text,text,text,text,text,text,text,bigint,text),
    public.finish_pos_product_edit_intake(uuid,uuid,text),public.cancel_pos_product_edit_intake(uuid,integer,uuid),
    public.requeue_pos_product_edit_intake(uuid,integer,uuid),public.abandon_pos_product_edit_intake(uuid,integer,integer,uuid) TO service_role;
