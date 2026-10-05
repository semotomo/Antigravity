-- P2eローカル。通常編集の業務値だけを固定し、GAS実行権を永続的に一度だけ消費する。本番未適用。
-- 既存claimはNode側の送信開始記録。このreceiptはGAS側の保存開始権であり、商品反映receiptとは別物。
CREATE TABLE public.pos_product_edit_dispatches (
    operation_id uuid PRIMARY KEY,
    store_id integer NOT NULL CHECK(store_id IN (6,7)),
    dispatch_text text NOT NULL CHECK(octet_length(dispatch_text) BETWEEN 1 AND 24576),
    dispatch_hash text NOT NULL CHECK(dispatch_hash ~ '^[0-9a-f]{64}$'),
    before_fingerprint_text text NOT NULL CHECK(octet_length(before_fingerprint_text) BETWEEN 1 AND 24576),
    expected_fingerprint_text text NOT NULL CHECK(octet_length(expected_fingerprint_text) BETWEEN 1 AND 24576),
    reviewed_at bigint NOT NULL CHECK(reviewed_at BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(operation_id,store_id,dispatch_hash),
    FOREIGN KEY(operation_id,store_id) REFERENCES public.pos_product_operations(id,store_id) ON DELETE RESTRICT,
    CHECK(dispatch_hash=encode(sha256(convert_to(dispatch_text,'UTF8')),'hex'))
);
CREATE TABLE public.pos_product_edit_dispatch_receipts (
    operation_id uuid PRIMARY KEY,
    store_id integer NOT NULL,
    dispatch_hash text NOT NULL,
    consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(operation_id,store_id,dispatch_hash)
        REFERENCES public.pos_product_edit_dispatches(operation_id,store_id,dispatch_hash) ON DELETE RESTRICT
);
ALTER TABLE public.pos_product_edit_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_dispatches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_dispatch_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_dispatch_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_edit_dispatches,public.pos_product_edit_dispatch_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_edit_dispatch_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_dispatches
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_dispatch_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_dispatches
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_dispatch_receipt_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_dispatch_receipts
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_dispatch_receipt_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_dispatch_receipts
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

-- JSONパーサーの例外原文にも入力値を出さない。
CREATE FUNCTION private.pos_product_dispatch_json(p_text text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF p_text IS NULL OR octet_length(p_text) NOT BETWEEN 1 AND 24576 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    -- jsonbが上書きする重複キーの下に、秘密値や許可外キーを隠して永続化させない。
    PERFORM private.assert_pos_product_dispatch_unique_json(p_text::json,0);
    RETURN p_text::jsonb;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
END $$;

CREATE FUNCTION private.assert_pos_product_dispatch_unique_json(p_value json,p_depth integer) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE child json;
BEGIN
    IF p_depth>8 THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023'; END IF;
    IF json_typeof(p_value)='object' THEN
        IF (SELECT count(*)<>count(DISTINCT key) FROM json_each(p_value)) THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        FOR child IN SELECT value FROM json_each(p_value) LOOP
            PERFORM private.assert_pos_product_dispatch_unique_json(child,p_depth+1);
        END LOOP;
    ELSIF json_typeof(p_value)='array' THEN
        FOR child IN SELECT value FROM json_array_elements(p_value) LOOP
            PERFORM private.assert_pos_product_dispatch_unique_json(child,p_depth+1);
        END LOOP;
    END IF;
END $$;

CREATE FUNCTION public.register_pos_product_edit_dispatch(
    p_actor_id uuid,p_store_id integer,p_operation_id uuid,p_payload_hash text,p_expected_version bigint,
    p_dispatch_text text,p_before_fingerprint_text text,p_expected_fingerprint_text text,p_reviewed_at bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; r public.pos_product_edit_dispatches; d jsonb; b jsonb; e jsonb; c jsonb;
    cat jsonb; merged jsonb; k text; mapped text; next_value jsonb; now_ms bigint; deadline bigint; n integer; registered_at timestamptz;
BEGIN
    op:=private.lock_pos_product_operation(p_actor_id,p_store_id,p_operation_id,p_payload_hash);
    IF op.kind<>'update' OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    IF op.status='prepared' AND op.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO r FROM public.pos_product_edit_dispatches WHERE operation_id=op.id AND store_id=op.store_id;
    IF FOUND THEN
        -- 再受付は完全同一の値だけ返す。後続状態や期限後も期限・基準値・操作状態を更新しない。
        IF r.dispatch_text IS DISTINCT FROM p_dispatch_text OR r.before_fingerprint_text IS DISTINCT FROM p_before_fingerprint_text
            OR r.expected_fingerprint_text IS DISTINCT FROM p_expected_fingerprint_text OR r.reviewed_at IS DISTINCT FROM p_reviewed_at THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        RETURN jsonb_build_object('operation',to_jsonb(op),'dispatch',to_jsonb(r));
    END IF;
    IF op.status<>'prepared' OR op.send_attempts<>0 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM private.assert_pos_product_dispatch_target(op);
    d:=private.pos_product_dispatch_json(p_dispatch_text);
    b:=private.pos_product_dispatch_json(p_before_fingerprint_text);
    e:=private.pos_product_dispatch_json(p_expected_fingerprint_text);
    PERFORM private.assert_pos_product_dispatch_object(d,ARRAY['operationId','actorId','storeId','janCode','before','patch','expiresAt']);
    IF d->'operationId' IS DISTINCT FROM to_jsonb(op.id::text) OR d->'actorId' IS DISTINCT FROM to_jsonb(op.actor_id::text)
        OR d->'storeId' IS DISTINCT FROM to_jsonb(op.store_id) OR d->'janCode' IS DISTINCT FROM to_jsonb(op.jan_code)
        OR jsonb_typeof(d->'expiresAt') IS DISTINCT FROM 'number' OR COALESCE(d->>'expiresAt','') !~ '^[1-9][0-9]{0,15}$' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    deadline:=(d->>'expiresAt')::bigint;
    now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    IF deadline>9007199254740991 OR deadline<=now_ms OR deadline-now_ms>120000
        OR to_timestamp(deadline::double precision/1000)>op.dispatch_expires_at
        OR p_reviewed_at IS NULL OR p_reviewed_at NOT BETWEEN 1 AND 9007199254740991
        OR p_reviewed_at>now_ms OR now_ms-p_reviewed_at>120000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM private.validate_pos_product_dispatch_business(d->'before',op.store_id,op.jan_code,op.pos_product_id);
    PERFORM private.assert_pos_product_dispatch_object(b,ARRAY['version','storeId','productId','janCode','identity','fields','settings']);
    PERFORM private.assert_pos_product_dispatch_object(e,ARRAY['version','storeId','productId','janCode','identity','fields','settings']);
    IF b->'version' IS DISTINCT FROM '"pos-product-edit.v1"'::jsonb OR b->'storeId' IS DISTINCT FROM to_jsonb(op.store_id)
        OR b->'productId' IS DISTINCT FROM to_jsonb(op.product_id_snapshot) OR b->'janCode' IS DISTINCT FROM to_jsonb(op.jan_code)
        OR b->'identity' IS DISTINCT FROM d->'before'->'identity' OR b->'settings' IS DISTINCT FROM d->'before'->'settings'
        OR b->'fields' IS DISTINCT FROM d->'before'->'fields' OR b-'fields' IS DISTINCT FROM e-'fields'
        OR encode(sha256(convert_to(p_before_fingerprint_text,'UTF8')),'hex') IS DISTINCT FROM op.command_text::jsonb->>'expectedFingerprint'
        OR encode(sha256(convert_to(p_expected_fingerprint_text,'UTF8')),'hex') IS DISTINCT FROM op.expected_result_fingerprint THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    c:=private.validate_pos_product_command(op.command_text);
    PERFORM private.validate_pos_product_dispatch_business((d->'before')||jsonb_build_object('fields',c->'fields'),op.store_id,op.jan_code,op.pos_product_id);
    IF e->'fields' IS DISTINCT FROM c->'fields' OR jsonb_typeof(d->'patch') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT count(*) INTO n FROM jsonb_object_keys(d->'patch');
    IF n NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023'; END IF;
    merged:=d->'before'->'fields';
    FOR k IN SELECT jsonb_object_keys(d->'patch') LOOP
        IF k NOT IN ('goodsName','goodsGroup','gddGoodsPrice','gddGoodsCost','gddSupplierCd') THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        PERFORM private.assert_pos_product_dispatch_string(d->'patch'->k,1000,true);
        mapped:=CASE k WHEN 'goodsName' THEN 'name' WHEN 'goodsGroup' THEN 'groupId' WHEN 'gddGoodsPrice' THEN 'price'
            WHEN 'gddGoodsCost' THEN 'cost' ELSE 'supplierId' END;
        next_value:=CASE WHEN k='gddSupplierCd' AND d->'patch'->>k='' THEN 'null'::jsonb ELSE d->'patch'->k END;
        IF merged->mapped IS NOT DISTINCT FROM next_value THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        IF k='goodsName' AND d->'patch'->>k<>btrim(d->'patch'->>k) THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        merged:=jsonb_set(merged,ARRAY[mapped],next_value,false);
    END LOOP;
    IF merged IS DISTINCT FROM c->'fields' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT catalog INTO cat FROM public.pos_product_edit_intents WHERE operation_id=op.id AND store_id=op.store_id;
    IF cat->'previousPosName' IS DISTINCT FROM d->'before'->'fields'->'name'
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'before'->'groups') g WHERE g->'id'=c->'fields'->'groupId' AND g->'name'=cat->'groupName')
        OR (c->'fields'->'supplierId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'before'->'suppliers') s
            WHERE s->'id'=c->'fields'->'supplierId' AND s->'name'=cat->'supplierName')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 型検査/行ロック待機で期限を過ぎても、失効した登録を初回作成しない。
    registered_at:=clock_timestamp();
    now_ms:=floor(extract(epoch FROM registered_at)*1000)::bigint;
    IF deadline<=now_ms OR deadline-now_ms>120000 OR registered_at>=op.dispatch_expires_at
        OR p_reviewed_at>now_ms OR now_ms-p_reviewed_at>120000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.pos_product_edit_dispatches(operation_id,store_id,dispatch_text,dispatch_hash,before_fingerprint_text,expected_fingerprint_text,reviewed_at,created_at)
        VALUES(op.id,op.store_id,p_dispatch_text,encode(sha256(convert_to(p_dispatch_text,'UTF8')),'hex'),p_before_fingerprint_text,p_expected_fingerprint_text,p_reviewed_at,registered_at)
        RETURNING * INTO r;
    RETURN jsonb_build_object('operation',to_jsonb(op),'dispatch',to_jsonb(r));
END $$;

CREATE FUNCTION public.get_pos_product_edit_dispatch(p_actor_id uuid,p_store_id integer,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; r public.pos_product_edit_dispatches; receipt public.pos_product_edit_dispatch_receipts;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    SELECT * INTO op FROM public.pos_product_operations WHERE id=p_operation_id AND actor_id=p_actor_id AND store_id=p_store_id;
    IF NOT FOUND OR op.kind<>'update' THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023'; END IF;
    SELECT * INTO r FROM public.pos_product_edit_dispatches WHERE operation_id=op.id AND store_id=op.store_id;
    SELECT * INTO receipt FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=op.id AND store_id=op.store_id;
    -- 期限・状態に関係なく固定業務値を返す。権限検査以外の書込みや自動再送はしない。
    RETURN jsonb_build_object('operation',to_jsonb(op),'dispatch',CASE WHEN r.operation_id IS NULL THEN NULL ELSE to_jsonb(r) END,
        'receipt',CASE WHEN receipt.operation_id IS NULL THEN NULL ELSE to_jsonb(receipt) END);
END $$;

CREATE FUNCTION public.consume_pos_product_edit_dispatch(p_actor_id uuid,p_store_id integer,p_operation_id uuid,p_dispatch_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; r public.pos_product_edit_dispatches; accepted boolean; now_ms bigint; consumed_at timestamptz;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    SELECT * INTO op FROM public.pos_product_operations WHERE id=p_operation_id AND actor_id=p_actor_id AND store_id=p_store_id FOR UPDATE;
    IF NOT FOUND OR op.kind<>'update' OR p_dispatch_hash IS NULL OR p_dispatch_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO r FROM public.pos_product_edit_dispatches WHERE operation_id=op.id AND store_id=op.store_id;
    IF NOT FOUND OR r.dispatch_hash<>p_dispatch_hash THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 同一receiptの再配送でもtrueを再発行しない。期限後・後続状態の再配送もfalseだけ返す。
    IF EXISTS(SELECT 1 FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=op.id) THEN
        accepted:=false;
    ELSE
        now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
        IF op.status<>'dispatching' OR op.send_attempts<>1 OR (r.dispatch_text::jsonb->>'expiresAt')::bigint<=now_ms
            OR op.dispatch_expires_at<=clock_timestamp() THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        PERFORM private.assert_pos_product_dispatch_target(op);
        -- 対象行ロックの待機後に再検査し、その同一時刻を消費記録へ固定する。
        consumed_at:=clock_timestamp();
        now_ms:=floor(extract(epoch FROM consumed_at)*1000)::bigint;
        IF (r.dispatch_text::jsonb->>'expiresAt')::bigint<=now_ms OR consumed_at>=op.dispatch_expires_at THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        INSERT INTO public.pos_product_edit_dispatch_receipts(operation_id,store_id,dispatch_hash,consumed_at)
            VALUES(op.id,op.store_id,r.dispatch_hash,consumed_at) ON CONFLICT(operation_id) DO NOTHING;
        accepted:=FOUND;
    END IF;
    RETURN jsonb_build_object('operationId',op.id,'actorId',op.actor_id,'storeId',op.store_id,'dispatchHash',r.dispatch_hash,'accepted',accepted);
END $$;

CREATE FUNCTION private.assert_pos_product_dispatch_object(p_value jsonb,p_keys text[]) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR NOT p_value ?& p_keys OR p_value-p_keys<>'{}'::jsonb THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
END $$;
CREATE FUNCTION private.assert_pos_product_dispatch_string(p_value jsonb,p_max integer,p_empty boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v text;
BEGIN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    v:=p_value#>>'{}';
    IF length(v)>p_max OR v ~ '[[:cntrl:]]' OR (NOT p_empty AND length(btrim(v))=0) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
END $$;

-- 許可するのはparserの業務DTOだけ。hidden・Cookie・URL・任意の追加プロパティは受け付けない。
CREATE FUNCTION private.validate_pos_product_dispatch_business(p_value jsonb,p_store integer,p_jan text,p_pos_id text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE i jsonb; f jsonb; s jsonb; c jsonb; k text;
BEGIN
    PERFORM private.assert_pos_product_dispatch_object(p_value,ARRAY['identity','fields','settings','groups','suppliers']);
    i:=p_value->'identity'; f:=p_value->'fields'; s:=p_value->'settings';
    PERFORM private.assert_pos_product_dispatch_object(i,ARRAY['posProductId','officeId','groupId','salesKind','productCode','manufacturerCode','exclusiveStore']);
    FOREACH k IN ARRAY ARRAY['posProductId','officeId','groupId','salesKind','productCode','manufacturerCode'] LOOP
        PERFORM private.assert_pos_product_dispatch_string(i->k,CASE WHEN k='posProductId' THEN 128 WHEN k IN ('productCode','manufacturerCode') THEN 13 ELSE 100 END,k IN ('productCode','manufacturerCode'));
    END LOOP;
    IF i->>'posProductId' IS DISTINCT FROM p_pos_id OR i->>'posProductId' !~ '^[A-Za-z0-9._:-]{1,128}$'
        OR i->>'officeId' IS DISTINCT FROM (CASE p_store WHEN 7 THEN '11053' WHEN 6 THEN '11054' END)
        OR i->>'groupId' IS DISTINCT FROM (CASE p_store WHEN 7 THEN '11098' WHEN 6 THEN '11099' END)
        OR i->'salesKind' IS DISTINCT FROM '"retail"'::jsonb OR i->'exclusiveStore' IS DISTINCT FROM 'true'::jsonb
        OR (i->>'productCode'<>p_jan AND i->>'manufacturerCode'<>p_jan)
        OR i->>'productCode' NOT IN ('',p_jan) OR i->>'manufacturerCode' NOT IN ('',p_jan) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM private.assert_pos_product_dispatch_object(f,ARRAY['name','groupId','price','cost','supplierId']);
    PERFORM private.assert_pos_product_dispatch_string(f->'name',200);
    FOREACH k IN ARRAY ARRAY['groupId','price','cost'] LOOP
        PERFORM private.assert_pos_product_dispatch_string(f->k,100);
    END LOOP;
    IF f->>'groupId' !~ '^[A-Za-z0-9._:-]{1,100}$' OR f->>'price' !~ '^(0|[1-9][0-9]{0,8})$' OR f->>'cost' !~ '^(0|[1-9][0-9]{0,8})$' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    IF f->'supplierId'<>'null'::jsonb THEN
        PERFORM private.assert_pos_product_dispatch_string(f->'supplierId',100);
        IF f->>'supplierId' !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
    END IF;
    PERFORM private.assert_pos_product_dispatch_object(s,ARRAY['nameKana','abbreviation','taxId','priceScope','priceMode','supplierScope','otherSettingsFingerprint']);
    PERFORM private.assert_pos_product_dispatch_string(s->'nameKana',1000,true);
    PERFORM private.assert_pos_product_dispatch_string(s->'abbreviation',1000,true);
    PERFORM private.assert_pos_product_dispatch_string(s->'taxId',100);
    PERFORM private.assert_pos_product_dispatch_string(s->'otherSettingsFingerprint',64);
    IF s->>'taxId' !~ '^[A-Za-z0-9._:-]{1,100}$' OR s->>'otherSettingsFingerprint' !~ '^[0-9a-f]{64}$'
        OR s->'priceScope' IS DISTINCT FROM '"all"'::jsonb OR s->'priceMode' IS DISTINCT FROM '"fixed"'::jsonb
        OR s->'supplierScope' IS DISTINCT FROM '"all"'::jsonb THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    FOREACH k IN ARRAY ARRAY['groups','suppliers'] LOOP
        IF jsonb_typeof(p_value->k) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
        FOR c IN SELECT value FROM jsonb_array_elements(p_value->k) LOOP
            PERFORM private.assert_pos_product_dispatch_object(c,ARRAY['id','name']);
            PERFORM private.assert_pos_product_dispatch_string(c->'id',100);
            PERFORM private.assert_pos_product_dispatch_string(c->'name',1000);
            IF c->>'id' !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
                RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
            END IF;
        END LOOP;
        IF (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_value->k)) THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
        END IF;
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'groups') choice WHERE choice->'id'=f->'groupId')
        OR (f->'supplierId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'suppliers') choice WHERE choice->'id'=f->'supplierId')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
END $$;

-- 状態遷移とは別に、受付時のintent・三つの予約・現在の店舗/JAN/商品を検査する。
CREATE FUNCTION private.assert_pos_product_dispatch_target(p_op public.pos_product_operations) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF p_op.kind<>'update' OR NOT EXISTS(SELECT 1 FROM public.pos_product_edit_intents WHERE operation_id=p_op.id AND store_id=p_op.store_id)
        OR (SELECT count(*) FROM public.pos_product_operation_locks WHERE operation_id=p_op.id AND store_id=p_op.store_id
            AND resource_key IN ('jan:'||p_op.jan_code,'product:'||p_op.product_id_snapshot,'pos:'||p_op.pos_product_id))<>3 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.products WHERE id=p_op.product_id_snapshot AND store_id=p_op.store_id AND jan_code=p_op.jan_code FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_DISPATCH_REJECTED' USING ERRCODE='22023'; END IF;
END $$;

REVOKE ALL ON FUNCTION private.pos_product_dispatch_json(text),private.assert_pos_product_dispatch_unique_json(json,integer),private.assert_pos_product_dispatch_object(jsonb,text[]),
    private.assert_pos_product_dispatch_string(jsonb,integer,boolean),private.validate_pos_product_dispatch_business(jsonb,integer,text,text),
    private.assert_pos_product_dispatch_target(public.pos_product_operations) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.register_pos_product_edit_dispatch(uuid,integer,uuid,text,bigint,text,text,text,bigint),
    public.get_pos_product_edit_dispatch(uuid,integer,uuid),public.consume_pos_product_edit_dispatch(uuid,integer,uuid,text)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_pos_product_edit_dispatch(uuid,integer,uuid,text,bigint,text,text,text,bigint),
    public.get_pos_product_edit_dispatch(uuid,integer,uuid),public.consume_pos_product_edit_dispatch(uuid,integer,uuid,text) TO service_role;
