-- 署名検証済みのGAS未送信応答だけを終端化する。期限/timeout/receipt不在だけの旧操作救済は追加しない。
-- HMAC・元要求signature・outcome/flagsの検証はNextのserver-onlyアダプターが担当する。
-- このservice専用RPCは検証済みの完全証拠だけを受け取り、対象と永続consumeを同一行ロックで検査する。
CREATE TABLE public.pos_product_edit_not_sent_proofs (
    operation_id uuid PRIMARY KEY,
    store_id integer NOT NULL CHECK(store_id IN (6,7)),
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    dispatch_hash text NOT NULL CHECK(dispatch_hash ~ '^[0-9a-f]{64}$'),
    proof_text text NOT NULL CHECK(octet_length(proof_text) BETWEEN 1 AND 4096),
    proof_hash text NOT NULL CHECK(proof_hash ~ '^[0-9a-f]{64}$'),
    stop_code text NOT NULL CHECK(stop_code IN ('POS_PRODUCT_EDIT_DISABLED','POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE',
        'POS_PRODUCT_EDIT_INVALID_REQUEST','POS_PRODUCT_EDIT_PREPARE_REJECTED','POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED')),
    source_row_version bigint NOT NULL CHECK(source_row_version BETWEEN 0 AND 9007199254740990),
    occurred_at bigint NOT NULL CHECK(occurred_at BETWEEN 1 AND 9007199254740991),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(operation_id,store_id,dispatch_hash) REFERENCES public.pos_product_edit_dispatches(operation_id,store_id,dispatch_hash) ON DELETE RESTRICT,
    CHECK(proof_hash=encode(sha256(convert_to(proof_text,'UTF8')),'hex'))
);
ALTER TABLE public.pos_product_edit_not_sent_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_not_sent_proofs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_edit_not_sent_proofs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_edit_not_sent_proof_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_not_sent_proofs
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_not_sent_proof_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_not_sent_proofs
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

ALTER TABLE public.pos_product_operations DROP CONSTRAINT pos_product_operations_status_check;
ALTER TABLE public.pos_product_operations ADD CONSTRAINT pos_product_operations_status_check CHECK(status IN
    ('prepared','dispatching','verifying','uncertain','pos_confirmed','db_pending','completed','rejected','not_sent'));
-- not_sentはclaim履歴を消さずsend1のまま。既存send/verifiedのCHECKはそのまま適用される。
DROP INDEX public.pos_product_operations_pending_idx;
CREATE INDEX pos_product_operations_pending_idx ON public.pos_product_operations(store_id,status)
    WHERE status NOT IN ('completed','rejected','not_sent');

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
            OR (OLD.status IN ('dispatching','verifying','uncertain') AND NEW.status='not_sent' AND NEW.last_event='dispatch_not_sent'
                AND NEW.kind='update' AND OLD.send_attempts=1 AND NEW.send_attempts=1 AND NEW.verified_fingerprint IS NULL
                AND EXISTS(SELECT 1 FROM public.pos_product_edit_not_sent_proofs proof
                    WHERE proof.operation_id=NEW.id AND proof.store_id=NEW.store_id AND proof.actor_id=NEW.actor_id
                        AND proof.source_row_version=OLD.row_version)
                AND NOT EXISTS(SELECT 1 FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=NEW.id)
                AND NOT EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=NEW.id))
        ) THEN RAISE EXCEPTION 'invalid transition' USING ERRCODE='22023'; END IF;
        NEW.updated_at:=clock_timestamp();
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION public.resolve_pos_product_edit_not_sent(
    p_actor_id uuid,p_store_id integer,p_operation_id uuid,p_payload_hash text,p_expected_version bigint,p_dispatch_hash text,p_proof_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; d public.pos_product_edit_dispatches; prior public.pos_product_edit_not_sent_proofs;
    proof jsonb; canonical_text text; happened bigint; now_ms bigint; k text;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    -- apply/cancel/syncと同じ店舗→操作の順。consumeもこの操作行を取得するため、receiptの見落としは起こさない。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023'; END IF;
    op:=private.lock_pos_product_operation(p_actor_id,p_store_id,p_operation_id,p_payload_hash);
    IF op.kind<>'update' OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
        OR p_dispatch_hash IS NULL OR p_dispatch_hash !~ '^[0-9a-f]{64}$'
        OR p_proof_text IS NULL OR octet_length(p_proof_text) NOT BETWEEN 1 AND 4096 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO d FROM public.pos_product_edit_dispatches WHERE operation_id=op.id AND store_id=op.store_id;
    IF NOT FOUND OR d.dispatch_hash<>p_dispatch_hash THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    proof:=private.pos_product_dispatch_json(p_proof_text);
    PERFORM private.assert_pos_product_dispatch_object(proof,ARRAY['version','audience','operationId','actorId','storeId',
        'dispatchHash','requestSignature','stopCode','occurredAt','signature']);
    FOREACH k IN ARRAY ARRAY['audience','operationId','actorId','dispatchHash','requestSignature','stopCode','signature'] LOOP
        IF jsonb_typeof(proof->k) IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
        END IF;
    END LOOP;
    IF jsonb_typeof(proof->'version') IS DISTINCT FROM 'number' OR proof->>'version' IS DISTINCT FROM '1'
        OR proof->>'audience' IS DISTINCT FROM 'kennel.pos-product-not-sent.v1'
        OR proof->>'operationId' IS DISTINCT FROM op.id::text OR proof->>'actorId' IS DISTINCT FROM op.actor_id::text
        OR jsonb_typeof(proof->'storeId') IS DISTINCT FROM 'number' OR proof->>'storeId' IS DISTINCT FROM op.store_id::text
        OR proof->>'dispatchHash' IS DISTINCT FROM p_dispatch_hash
        OR (proof->>'requestSignature') !~ '^[0-9a-f]{64}$' OR (proof->>'signature') !~ '^[0-9a-f]{64}$'
        OR proof->>'stopCode' NOT IN ('POS_PRODUCT_EDIT_DISABLED','POS_PRODUCT_EDIT_CONSUMER_UNAVAILABLE',
            'POS_PRODUCT_EDIT_INVALID_REQUEST','POS_PRODUCT_EDIT_PREPARE_REJECTED','POS_PRODUCT_EDIT_EXECUTION_WINDOW_CLOSED')
        OR jsonb_typeof(proof->'occurredAt') IS DISTINCT FROM 'number' OR (proof->>'occurredAt') !~ '^[1-9][0-9]{0,15}$' THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    happened:=(proof->>'occurredAt')::bigint;
    now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    IF happened>9007199254740991 OR happened<d.reviewed_at OR happened>now_ms+5000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 全値が固定形式なので、JSの再帰キーsortと同じ本文bytesを再構築できる。重複キーは上のparserで拒否する。
    canonical_text:=format('{"actorId":%s,"audience":%s,"dispatchHash":%s,"occurredAt":%s,"operationId":%s,"requestSignature":%s,"signature":%s,"stopCode":%s,"storeId":%s,"version":%s}',
        proof->'actorId',proof->'audience',proof->'dispatchHash',proof->'occurredAt',proof->'operationId',proof->'requestSignature',
        proof->'signature',proof->'stopCode',proof->'storeId',proof->'version');
    IF p_proof_text IS DISTINCT FROM canonical_text THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 署名付き停止結果でも消費済みなら解除しない。先行consumeがcommitした後の状態を必ず再検査する。
    IF EXISTS(SELECT 1 FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=op.id)
        OR EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=op.id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO prior FROM public.pos_product_edit_not_sent_proofs WHERE operation_id=op.id;
    IF FOUND THEN
        IF op.status<>'not_sent' OR op.send_attempts<>1 OR prior.actor_id<>op.actor_id OR prior.store_id<>op.store_id
            OR prior.dispatch_hash<>p_dispatch_hash OR prior.proof_text IS DISTINCT FROM p_proof_text
            OR p_expected_version NOT IN (prior.source_row_version,op.row_version)
            OR EXISTS(SELECT 1 FROM public.pos_product_operation_locks WHERE operation_id=op.id) THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
        END IF;
        RETURN jsonb_build_object('operation',to_jsonb(op),'recovered',false);
    END IF;
    IF op.row_version IS DISTINCT FROM p_expected_version OR op.row_version>=9007199254740991 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='40001';
    END IF;
    IF op.status NOT IN ('dispatching','verifying','uncertain') OR op.send_attempts<>1 OR op.verified_fingerprint IS NOT NULL
        OR NOT EXISTS(SELECT 1 FROM public.pos_product_edit_intents WHERE operation_id=op.id AND store_id=op.store_id)
        OR (SELECT count(*) FROM public.pos_product_operation_locks WHERE operation_id=op.id)<>3
        OR (SELECT count(*) FROM public.pos_product_operation_locks WHERE operation_id=op.id AND store_id=op.store_id
            AND resource_key IN ('jan:'||op.jan_code,'product:'||op.product_id_snapshot,'pos:'||op.pos_product_id))<>3 THEN
        RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_REJECTED' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.pos_product_edit_not_sent_proofs(operation_id,store_id,actor_id,dispatch_hash,proof_text,proof_hash,stop_code,source_row_version,occurred_at)
        VALUES(op.id,op.store_id,op.actor_id,p_dispatch_hash,p_proof_text,encode(sha256(convert_to(p_proof_text,'UTF8')),'hex'),
            proof->>'stopCode',op.row_version,happened);
    UPDATE public.pos_product_operations SET status='not_sent',row_version=row_version+1,last_event='dispatch_not_sent'
        WHERE id=op.id RETURNING * INTO op;
    DELETE FROM public.pos_product_operation_locks WHERE operation_id=op.id AND store_id=op.store_id;
    RETURN jsonb_build_object('operation',to_jsonb(op),'recovered',true);
END $$;
REVOKE ALL ON FUNCTION public.resolve_pos_product_edit_not_sent(uuid,integer,uuid,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_pos_product_edit_not_sent(uuid,integer,uuid,text,bigint,text,text) TO service_role;

-- 最新sync関数の旧writer停止/999999除外を維持し、terminal集合だけを限定変更する。
DO $not_sent_terminal$
DECLARE target regprocedure; definition text; needle text:='''completed'',''rejected'''; expected integer; observed integer;
BEGIN
    FOR target,expected IN SELECT * FROM (VALUES
        ('public.begin_product_master_sync(integer)'::regprocedure,1),
        ('public.apply_product_master_sync(uuid,integer,jsonb)'::regprocedure,1),
        ('public.get_pos_product_edit_recovery_state(uuid,integer,integer,uuid)'::regprocedure,2),
        ('public.cancel_pos_product_edit(uuid,integer,integer,uuid)'::regprocedure,1)
    ) AS targets(fn,n) LOOP
        definition:=pg_get_functiondef(target);
        observed:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
        IF observed<>expected THEN
            RAISE EXCEPTION 'POS_PRODUCT_EDIT_NOT_SENT_TERMINAL_SOURCE_MISMATCH' USING ERRCODE='55000';
        END IF;
        EXECUTE replace(definition,needle,'''completed'',''rejected'',''not_sent''');
    END LOOP;
END $not_sent_terminal$;
