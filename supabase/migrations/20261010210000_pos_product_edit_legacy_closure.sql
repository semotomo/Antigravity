-- 当時の公開v57/Next/DB契約を別途監査した旧1操作専用。署名付きGAS証拠を後付けしない。
-- 適用だけでは操作/商品/予約を変更しない。実行には別の対象確認・本番承認が必要。
CREATE TABLE public.pos_product_edit_legacy_closures (
    operation_id uuid PRIMARY KEY CHECK(operation_id='eb967ccc-57b6-454c-b722-74c7a7c5885d'::uuid),
    store_id integer NOT NULL CHECK(store_id=7),
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    product_id_snapshot integer NOT NULL CHECK(product_id_snapshot=4779),
    jan_code text NOT NULL CHECK(jan_code='4582107173062'),
    payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
    dispatch_hash text NOT NULL CHECK(dispatch_hash ~ '^[0-9a-f]{64}$'),
    source_row_version bigint NOT NULL CHECK(source_row_version=2),
    evidence_text text NOT NULL CHECK(octet_length(evidence_text) BETWEEN 1 AND 4096),
    evidence_hash text NOT NULL CHECK(evidence_hash=encode(sha256(convert_to(evidence_text,'UTF8')),'hex')),
    reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 10 AND 500 AND reason !~ '[[:cntrl:]]'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(operation_id,store_id,dispatch_hash) REFERENCES public.pos_product_edit_dispatches(operation_id,store_id,dispatch_hash) ON DELETE RESTRICT
);
ALTER TABLE public.pos_product_edit_legacy_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_edit_legacy_closures FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_edit_legacy_closures FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_edit_legacy_closure_immutable BEFORE UPDATE OR DELETE ON public.pos_product_edit_legacy_closures
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_edit_legacy_closure_no_truncate BEFORE TRUNCATE ON public.pos_product_edit_legacy_closures
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

-- pg_get_functiondefの版別書式差でなく、監査済み本文と属性を確認する。Windowsの改行だけ正規化する。
CREATE FUNCTION private.assert_legacy_pos_product_consume_contract() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE valid boolean;
BEGIN
    WITH expected(fn,body_hash,definer,language_name,volatility) AS (VALUES
        ('public.consume_pos_product_edit_dispatch(uuid,integer,uuid,text)'::regprocedure,
            'c074cbd4241bb920f8112e202611e9b85df9e304790ab6fb5b7090081a3ac48c',true,'plpgsql','v'),
        ('private.assert_pos_product_dispatch_target(public.pos_product_operations)'::regprocedure,
            '98ba4e506d14ad96ffb68fb35835a3d2dea660aaaf118a4ccb3be607799b6364',false,'plpgsql','v'),
        ('private.assert_pos_product_manager(uuid,integer)'::regprocedure,
            'eebc86795692dc25a734ec7f91a307d1408c27b90ca0511923ff593795f5f680',false,'plpgsql','v'),
        ('private.lock_pos_product_operation(uuid,integer,uuid,text)'::regprocedure,
            'c299d60739540edf0588ff0cd9a8918317cc3e239ed939116186baa43d59015a',false,'plpgsql','v'),
        ('private.prevent_pos_product_audit_mutation()'::regprocedure,
            'c0f6dc7aecf62011a313236c95fc6bdde39fe27112cb0378bab512a70c30550c',false,'plpgsql','v'),
        ('private.audit_pos_product_operation()'::regprocedure,
            '3a596d59b0f04f67d04a148b8160700ab2b88a00e1f855aa8702c280d553307e',true,'plpgsql','v'),
        ('private.pos_product_edit_values(public.products)'::regprocedure,
            '594d3ca77346df3a873f6deb0f485a065d831f2e1dea3bcfa999c8ce9370a351',false,'sql','i')
    ) SELECT count(*)=7 AND bool_and((
        encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=e.body_hash
        AND p.prosecdef=e.definer AND p.provolatile::text=e.volatility AND l.lanname=e.language_name
        AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[] AND p.proowner=c.relowner
    ) IS TRUE) INTO valid FROM expected e JOIN pg_proc p ON p.oid=e.fn JOIN pg_language l ON l.oid=p.prolang
        CROSS JOIN pg_class c WHERE c.oid='public.pos_product_operations'::regclass;
    IF valid IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CONTRACT_CHANGED' USING ERRCODE='55000';
    END IF;
    -- receiptを消せる権限/無効triggerがあれば「0件」を根拠として扱わない。
    SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner=(
        SELECT relowner FROM pg_class WHERE oid='public.pos_product_operations'::regclass
    ) AND NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated'),('service_role')) r(role_name)
        WHERE has_table_privilege(r.role_name,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
        AND (SELECT count(*)=2 AND bool_and(t.tgenabled IN ('O','A') AND (
            (t.tgname='pos_edit_dispatch_receipt_immutable' AND t.tgtype=27)
            OR (t.tgname='pos_edit_dispatch_receipt_no_truncate' AND t.tgtype=34)
        ) AND t.tgqual IS NULL AND t.tgfoid='private.prevent_pos_product_audit_mutation()'::regprocedure)
            FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
    INTO valid FROM pg_class c WHERE c.oid='public.pos_product_edit_dispatch_receipts'::regclass;
    IF valid IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CONTRACT_CHANGED' USING ERRCODE='55000';
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_legacy_pos_product_consume_contract() FROM PUBLIC,anon,authenticated,service_role;

-- 新signed not_sent条件を一字も緩めず、別event/別監査の限定分岐だけを加える。
DO $legacy_guard$
DECLARE definition text; needle text:='        ) THEN RAISE EXCEPTION ''invalid transition'' USING ERRCODE=''22023''; END IF;';
    branch text:=$branch$
            OR (OLD.id='eb967ccc-57b6-454c-b722-74c7a7c5885d'::uuid AND OLD.store_id=7
                AND OLD.product_id_snapshot=4779 AND OLD.jan_code='4582107173062' AND OLD.kind='update'
                AND OLD.status='uncertain' AND OLD.row_version=2 AND OLD.send_attempts=1
                AND OLD.last_event='outcome_unknown' AND OLD.verified_fingerprint IS NULL
                AND NEW.status='not_sent' AND NEW.last_event='legacy_dispatch_not_sent' AND NEW.send_attempts=1
                AND NEW.verified_fingerprint IS NULL
                AND EXISTS(SELECT 1 FROM public.pos_product_edit_legacy_closures a
                    WHERE a.operation_id=NEW.id AND a.store_id=NEW.store_id AND a.actor_id=NEW.actor_id
                        AND a.payload_hash=NEW.payload_hash AND a.source_row_version=OLD.row_version)
                AND NOT EXISTS(SELECT 1 FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=NEW.id)
                AND NOT EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=NEW.id)
                AND NOT EXISTS(SELECT 1 FROM public.pos_product_edit_not_sent_proofs WHERE operation_id=NEW.id))
$branch$;
BEGIN
    definition:=pg_get_functiondef('private.guard_pos_product_operation()'::regprocedure);
    IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
        OR position('NEW.last_event=''dispatch_not_sent''' IN definition)=0
        OR position('pos_product_edit_not_sent_proofs' IN definition)=0 THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_GUARD_SOURCE_MISMATCH' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,needle,branch||needle);
END $legacy_guard$;

-- 通常のNext/API/UIへは接続しない、対象確認済みの保守専用受付。
-- 証拠は外部公開版/実POS読取り/復元なしを人が再確認した申告であり、GAS署名ではない。
CREATE FUNCTION public.close_legacy_pos_product_edit(
    p_actor_id uuid,p_store_id integer,p_operation_id uuid,p_payload_hash text,p_expected_version bigint,
    p_dispatch_hash text,p_evidence_text text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; d public.pos_product_edit_dispatches; prior public.pos_product_edit_legacy_closures;
    intent public.pos_product_edit_intents; product public.products; e jsonb; dispatch jsonb; cmd jsonb;
    canonical_text text; now_ms bigint; reviewed bigint;
BEGIN
    IF p_operation_id IS DISTINCT FROM 'eb967ccc-57b6-454c-b722-74c7a7c5885d'::uuid OR p_store_id IS DISTINCT FROM 7
        OR p_expected_version IS NULL OR p_expected_version NOT IN (2,3)
        OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
        OR p_dispatch_hash IS NULL OR p_dispatch_hash !~ '^[0-9a-f]{64}$'
        OR p_evidence_text IS NULL OR octet_length(p_evidence_text) NOT BETWEEN 1 AND 4096
        OR p_reason IS NULL OR p_reason IS DISTINCT FROM btrim(p_reason)
        OR length(p_reason) NOT BETWEEN 10 AND 500 OR p_reason ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023'; END IF;
    op:=private.lock_pos_product_operation(p_actor_id,p_store_id,p_operation_id,p_payload_hash);
    -- consumeは同じ操作行を先に取る。行待機後のcommit済みreceiptを必ず検査する。
    IF op.kind<>'update' OR op.product_id_snapshot IS DISTINCT FROM 4779 OR op.jan_code IS DISTINCT FROM '4582107173062'
        OR EXISTS(SELECT 1 FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=op.id)
        OR EXISTS(SELECT 1 FROM public.pos_product_edit_receipts WHERE operation_id=op.id)
        OR EXISTS(SELECT 1 FROM public.pos_product_edit_not_sent_proofs WHERE operation_id=op.id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO d FROM public.pos_product_edit_dispatches WHERE operation_id=op.id AND store_id=op.store_id;
    IF NOT FOUND OR d.dispatch_hash IS DISTINCT FROM p_dispatch_hash THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO prior FROM public.pos_product_edit_legacy_closures WHERE operation_id=op.id;
    IF FOUND THEN
        -- 応答消失時の同じ受付だけを返す。終端後に別操作が商品を変えていても旧基準で誤拒否しない。
        IF op.status<>'not_sent' OR op.row_version<>3 OR op.send_attempts<>1
            OR op.last_event<>'legacy_dispatch_not_sent' OR op.verified_fingerprint IS NOT NULL
            OR prior.actor_id IS DISTINCT FROM op.actor_id OR prior.payload_hash IS DISTINCT FROM p_payload_hash
            OR prior.dispatch_hash IS DISTINCT FROM p_dispatch_hash OR prior.evidence_text IS DISTINCT FROM p_evidence_text
            OR prior.reason IS DISTINCT FROM p_reason
            OR EXISTS(SELECT 1 FROM public.pos_product_operation_locks WHERE operation_id=op.id) THEN
            RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
        END IF;
        RETURN jsonb_build_object('operation',to_jsonb(op),'closed',false);
    END IF;
    IF op.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='40001';
    END IF;
    PERFORM private.assert_legacy_pos_product_consume_contract();
    e:=private.pos_product_dispatch_json(p_evidence_text);
    PERFORM private.assert_pos_product_dispatch_object(e,ARRAY['version','basis','gasVersion','gasSourceSha256',
        'nextCommit','dbAuditSha256','noRestoreConfirmed','posBaselineConfirmed','reviewedAt']);
    IF e-'reviewedAt' IS DISTINCT FROM jsonb_build_object('version',1,'basis','operator-reviewed-legacy-consume-barrier.v1',
        'gasVersion',57,'gasSourceSha256','431e3b1313273c7b4b4869f373e40f17bc0c56c6a4026e78f8a0c4e688a5c287',
        'nextCommit','ee54a7e1fe7e1c1fcfafdad4354a8cc4c84e69b9',
        'dbAuditSha256','fde2c0737cc3e7f4919e1cfae783a4cbd0b16e7094c31066b54ad002caaf51be',
        'noRestoreConfirmed',true,'posBaselineConfirmed',true)
        OR jsonb_typeof(e->'reviewedAt') IS DISTINCT FROM 'number' OR (e->>'reviewedAt') !~ '^[1-9][0-9]{0,15}$' THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    reviewed:=(e->>'reviewedAt')::bigint;
    canonical_text:=format('{"basis":%s,"dbAuditSha256":%s,"gasSourceSha256":%s,"gasVersion":%s,"nextCommit":%s,"noRestoreConfirmed":%s,"posBaselineConfirmed":%s,"reviewedAt":%s,"version":%s}',
        e->'basis',e->'dbAuditSha256',e->'gasSourceSha256',e->'gasVersion',e->'nextCommit',e->'noRestoreConfirmed',
        e->'posBaselineConfirmed',e->'reviewedAt',e->'version');
    IF p_evidence_text IS DISTINCT FROM canonical_text THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO product FROM public.products WHERE id=op.product_id_snapshot AND store_id=op.store_id AND jan_code=op.jan_code FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023'; END IF;
    SELECT * INTO intent FROM public.pos_product_edit_intents WHERE operation_id=op.id AND store_id=op.store_id;
    IF NOT FOUND OR private.pos_product_edit_values(product) IS DISTINCT FROM intent.baseline
        OR intent.baseline IS DISTINCT FROM '{"product_name":"95ミツヤ もみじ焼き","category":"犬おやつ","product_group":"犬おやつ","selling_price":199,"cost_price":95,"supplier_name":"モリミツ"}'::jsonb THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    dispatch:=private.pos_product_dispatch_json(d.dispatch_text);
    cmd:=private.validate_pos_product_command(op.command_text);
    -- 固定本文のhash、店舗/JAN/内部IDと当時の変更前/変更後5項目を再確認する。
    IF encode(sha256(convert_to(op.command_text,'UTF8')),'hex') IS DISTINCT FROM p_payload_hash
        OR encode(sha256(convert_to(d.dispatch_text,'UTF8')),'hex') IS DISTINCT FROM p_dispatch_hash
        OR dispatch->>'operationId' IS DISTINCT FROM op.id::text OR dispatch->>'actorId' IS DISTINCT FROM op.actor_id::text
        OR dispatch->'storeId' IS DISTINCT FROM '7'::jsonb OR dispatch->>'janCode' IS DISTINCT FROM op.jan_code
        OR dispatch#>>'{before,identity,posProductId}' IS DISTINCT FROM op.pos_product_id
        OR dispatch#>>'{before,identity,officeId}' IS DISTINCT FROM '11053'
        OR dispatch#>>'{before,identity,groupId}' IS DISTINCT FROM '11098'
        OR dispatch#>>'{before,identity,productCode}' IS DISTINCT FROM op.jan_code
        OR dispatch#>>'{before,identity,manufacturerCode}' IS DISTINCT FROM op.jan_code
        OR dispatch#>'{before,fields}' IS DISTINCT FROM '{"name":"95ミツヤ もみじ焼き","groupId":"721420885","price":"199","cost":"95","supplierId":"721420424"}'::jsonb
        OR dispatch->'patch' IS DISTINCT FROM '{"goodsName":"ミツヤ もみじ焼き","gddGoodsPrice":"200","gddGoodsCost":"100"}'::jsonb
        OR cmd->'fields' IS DISTINCT FROM '{"name":"ミツヤ もみじ焼き","groupId":"721420885","price":"200","cost":"100","supplierId":"721420424"}'::jsonb
        OR op.status<>'uncertain' OR op.row_version<>2 OR op.send_attempts<>1 OR op.last_event<>'outcome_unknown'
        OR op.verified_fingerprint IS NOT NULL
        OR (SELECT count(*) FROM public.pos_product_operation_locks WHERE operation_id=op.id)<>3
        OR (SELECT count(*) FROM public.pos_product_operation_locks WHERE operation_id=op.id AND store_id=op.store_id
            AND resource_key IN ('jan:'||op.jan_code,'product:'||op.product_id_snapshot,'pos:'||op.pos_product_id))<>3
        OR (SELECT count(*) FROM public.pos_product_operation_events WHERE operation_id=op.id)<>3
        OR (SELECT count(*) FROM public.pos_product_operation_events WHERE operation_id=op.id AND store_id=op.store_id AND actor_id=op.actor_id AND (
            (row_version=0 AND event_name='prepared' AND previous_status IS NULL AND new_status='prepared')
            OR (row_version=1 AND event_name='claim_dispatch' AND previous_status='prepared' AND new_status='dispatching')
            OR (row_version=2 AND event_name='outcome_unknown' AND previous_status='dispatching' AND new_status='uncertain')) )<>3 THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 商品行待機後にも人の確認時刻を再確認する。期限切れ自体を未送信証明には使わない。
    now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
    IF reviewed>9007199254740991 OR reviewed>now_ms OR now_ms-reviewed>900000 THEN
        RAISE EXCEPTION 'POS_PRODUCT_LEGACY_CLOSURE_REJECTED' USING ERRCODE='22023';
    END IF;
    -- 商品行待機中のDDL/GRANT変化も拒否する。実行中の特権保守は運用上も排他する。
    PERFORM private.assert_legacy_pos_product_consume_contract();
    INSERT INTO public.pos_product_edit_legacy_closures(operation_id,store_id,actor_id,product_id_snapshot,jan_code,
        payload_hash,dispatch_hash,source_row_version,evidence_text,evidence_hash,reason)
    VALUES(op.id,op.store_id,op.actor_id,op.product_id_snapshot,op.jan_code,op.payload_hash,d.dispatch_hash,op.row_version,
        p_evidence_text,encode(sha256(convert_to(p_evidence_text,'UTF8')),'hex'),p_reason);
    UPDATE public.pos_product_operations SET status='not_sent',row_version=row_version+1,last_event='legacy_dispatch_not_sent'
        WHERE id=op.id RETURNING * INTO op;
    DELETE FROM public.pos_product_operation_locks WHERE operation_id=op.id AND store_id=op.store_id;
    RETURN jsonb_build_object('operation',to_jsonb(op),'closed',true);
END $$;
REVOKE ALL ON FUNCTION public.close_legacy_pos_product_edit(uuid,integer,uuid,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.close_legacy_pos_product_edit(uuid,integer,uuid,text,bigint,text,text,text) TO service_role;
