-- 署名要求UUIDを永続開始権に固定する。再要求や結果確認によってCSVを再取得しない。
CREATE TABLE public.product_master_sync_requests (
    id uuid PRIMARY KEY,
    store_id integer NOT NULL REFERENCES public.product_master_store_versions(store_id) CHECK(store_id IN (6,7)),
    state text NOT NULL CHECK(state IN ('started','rejected')),
    code text CHECK(code IN ('PRODUCT_SYNC_PENDING_EDIT','PRODUCT_SYNC_PENDING_SYNC','PRODUCT_SYNC_STALE','PRODUCT_SYNC_INVALID_DATA','PRODUCT_SYNC_EXPIRED')),
    run_id uuid UNIQUE REFERENCES public.product_master_sync_runs(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK((state='started' AND run_id=id AND code IS NULL) OR (state='rejected' AND code IS NOT NULL))
);
ALTER TABLE public.product_master_sync_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_master_sync_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_master_sync_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.begin_product_master_sync_request(p_store_id integer,p_request_id uuid,p_request_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='30s' AS $$
DECLARE v_request public.product_master_sync_requests; v_run jsonb; v_code text;
BEGIN
    IF p_store_id IS NULL OR p_store_id NOT IN (6,7) OR p_request_id IS NULL
        OR p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023';
    END IF;
    -- applyと状態確認も店舗版→開始権→実行行の順を守り、期限判定と実行を直列化する。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023'; END IF;
    INSERT INTO public.product_master_sync_requests(id,store_id,state,code)
        VALUES(p_request_id,p_store_id,'rejected','PRODUCT_SYNC_EXPIRED') ON CONFLICT(id) DO NOTHING;
    IF NOT FOUND THEN
        SELECT * INTO v_request FROM public.product_master_sync_requests WHERE id=p_request_id FOR UPDATE;
        v_code := CASE WHEN v_request.store_id=p_store_id THEN 'PRODUCT_SYNC_STALE' ELSE 'PRODUCT_SYNC_INVALID_DATA' END;
        RETURN jsonb_build_object('accepted',false,'requestId',p_request_id,'storeId',p_store_id,'code',v_code,'outcome','rejected');
    END IF;
    IF p_request_expires_at IS NULL OR p_request_expires_at<=clock_timestamp()
        OR p_request_expires_at>clock_timestamp()+interval '125 seconds' THEN
        RETURN jsonb_build_object('accepted',false,'requestId',p_request_id,'storeId',p_store_id,'code','PRODUCT_SYNC_EXPIRED','outcome','rejected');
    END IF;
    -- 通知記録前にNextが終了しても、未確定の実行中に別UUIDで再開しない。
    PERFORM id FROM public.product_master_sync_runs WHERE store_id=p_store_id AND state='pending' ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.product_master_sync_runs WHERE store_id=p_store_id AND state='pending' AND expires_at>=clock_timestamp()) THEN
        UPDATE public.product_master_sync_requests SET code='PRODUCT_SYNC_PENDING_SYNC' WHERE id=p_request_id;
        RETURN jsonb_build_object('accepted',false,'requestId',p_request_id,'storeId',p_store_id,'code','PRODUCT_SYNC_PENDING_SYNC','outcome','rejected');
    END IF;
    -- 既存fenceの開始をdefiner内部で一回だけ利用する。明示拒否はsubtransactionを巻き戻し開始権を閉じる。
    BEGIN
        v_run := public.begin_product_master_sync(p_store_id);
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            IF SQLERRM<>'pending product operation' THEN RAISE; END IF;
            UPDATE public.product_master_sync_requests SET code='PRODUCT_SYNC_PENDING_EDIT' WHERE id=p_request_id;
            RETURN jsonb_build_object('accepted',false,'requestId',p_request_id,'storeId',p_store_id,'code','PRODUCT_SYNC_PENDING_EDIT','outcome','rejected');
        WHEN SQLSTATE '22023' THEN
            IF SQLERRM<>'invalid sync store' THEN RAISE; END IF;
            UPDATE public.product_master_sync_requests SET code='PRODUCT_SYNC_INVALID_DATA' WHERE id=p_request_id;
            RETURN jsonb_build_object('accepted',false,'requestId',p_request_id,'storeId',p_store_id,'code','PRODUCT_SYNC_INVALID_DATA','outcome','rejected');
    END;
    UPDATE public.product_master_sync_runs SET id=p_request_id WHERE id=(v_run->>'id')::uuid;
    UPDATE public.product_master_sync_requests SET state='started',code=NULL,run_id=p_request_id WHERE id=p_request_id;
    RETURN jsonb_build_object('accepted',true,'id',p_request_id,'storeId',p_store_id,'startedAt',v_run->'startedAt');
END $$;

-- 状態確認は開始済みの正本を読む。未作成なら開始権tombstoneを確定し遅延要求を永久拒否する。
CREATE FUNCTION public.get_product_master_sync_request(p_store_id integer,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='30s' AS $$
DECLARE v_request public.product_master_sync_requests; v_run public.product_master_sync_runs;
BEGIN
    IF p_store_id IS NULL OR p_store_id NOT IN (6,7) OR p_request_id IS NULL
        OR p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023'; END IF;
    INSERT INTO public.product_master_sync_requests(id,store_id,state,code)
        VALUES(p_request_id,p_store_id,'rejected','PRODUCT_SYNC_EXPIRED') ON CONFLICT(id) DO NOTHING;
    SELECT * INTO v_request FROM public.product_master_sync_requests WHERE id=p_request_id FOR UPDATE;
    IF v_request.store_id<>p_store_id THEN RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023'; END IF;
    -- 切替前の旧begin正本も確認する。要求記録なしを未適用とみなす前に、同UUIDの実行を必ずロックする。
    SELECT * INTO v_run FROM public.product_master_sync_runs WHERE id=p_request_id FOR UPDATE;
    IF FOUND THEN
        IF v_run.store_id<>p_store_id THEN RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023'; END IF;
        IF v_request.run_id IS NULL THEN
            -- 実在する同店舗の正本だけを引き継ぐ。新規開始・CSV取得・期限延長は行わない。
            UPDATE public.product_master_sync_requests SET state='started',code=NULL,run_id=v_run.id
                WHERE id=p_request_id RETURNING * INTO v_request;
        ELSIF v_request.run_id<>v_run.id THEN
            RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023';
        END IF;
    ELSIF v_request.state='started' OR v_request.run_id IS NOT NULL THEN
        RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023';
    END IF;
    IF v_request.state='rejected' THEN
        RETURN jsonb_build_object('found',v_request.run_id IS NOT NULL,'terminal',true,'state','rejected','success',false,
            'storeId',p_store_id,'requestId',p_request_id,'code',v_request.code,'outcome','rejected')
            || CASE WHEN v_request.run_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('runId',v_request.run_id) END;
    END IF;
    -- applyが進行中なら上記ロックで完了を待ち、応答消失でも成功を正本で確認する。
    IF v_run.state='applied' THEN
        IF v_run.result IS NULL OR v_run.result->'success'<>'true'::jsonb OR jsonb_typeof(v_run.result->'count')<>'number'
            OR jsonb_typeof(v_run.result->'deactivatedCount')<>'number' OR jsonb_typeof(v_run.result->'syncStartedAt')<>'string' THEN
            RAISE EXCEPTION 'PRODUCT_SYNC_INVALID_DATA' USING ERRCODE='22023';
        END IF;
        RETURN jsonb_build_object('found',true,'terminal',true,'state','applied','success',true,'storeId',p_store_id,
            'requestId',p_request_id,'runId',v_run.id,'csvRowCount',v_run.result->'count',
            'syncResult',jsonb_build_object('success',true,'count',v_run.result->'count',
                'deactivatedCount',v_run.result->'deactivatedCount','syncStartedAt',v_run.result->'syncStartedAt'));
    END IF;
    IF v_run.expires_at<clock_timestamp() THEN
        UPDATE public.product_master_sync_requests SET state='rejected',code='PRODUCT_SYNC_EXPIRED' WHERE id=p_request_id;
        RETURN jsonb_build_object('found',true,'terminal',true,'state','rejected','success',false,'storeId',p_store_id,
            'requestId',p_request_id,'runId',v_run.id,'code','PRODUCT_SYNC_EXPIRED','outcome','rejected');
    END IF;
    RETURN jsonb_build_object('found',true,'terminal',false,'state','pending','success',false,'storeId',p_store_id,
        'requestId',p_request_id,'runId',v_run.id,'code','PRODUCT_SYNC_UNKNOWN','outcome','unknown',
        'startedAt',v_run.started_at,'expiresAt',v_run.expires_at);
END $$;

REVOKE ALL ON FUNCTION public.begin_product_master_sync(integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_product_master_sync_request(integer,uuid,timestamptz),public.get_product_master_sync_request(integer,uuid)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_product_master_sync_request(integer,uuid,timestamptz),public.get_product_master_sync_request(integer,uuid)
    TO service_role;
