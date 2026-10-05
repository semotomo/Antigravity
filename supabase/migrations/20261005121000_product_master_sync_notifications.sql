-- 同期結果の固定コードだけを保存する。GAS本文・例外文・資格情報を保存する列は設けない。
CREATE TABLE public.product_master_sync_notifications (
    attempt_id uuid NOT NULL,
    store_id integer NOT NULL REFERENCES public.stores(id) CHECK(store_id IN (6,7)),
    source text NOT NULL CHECK(source IN ('manual','cron','recovery')),
    outcome text NOT NULL CHECK(outcome IN ('succeeded','rejected','unknown')),
    code text,
    run_id uuid,
    started_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    resolved_at timestamptz,
    resolution_outcome text CHECK(resolution_outcome IN ('succeeded','rejected')),
    PRIMARY KEY(attempt_id,store_id),
    CHECK((outcome='succeeded' AND code IS NULL AND resolved_at IS NULL) OR
      (outcome='unknown' AND code IS NOT NULL AND code='PRODUCT_SYNC_UNKNOWN') OR
      (outcome='rejected' AND code IS NOT NULL AND code IN ('PRODUCT_SYNC_PENDING_EDIT','PRODUCT_SYNC_PENDING_SYNC','PRODUCT_SYNC_STALE','PRODUCT_SYNC_INVALID_DATA',
        'PRODUCT_SYNC_EXPIRED','PRODUCT_SYNC_DISABLED','PRODUCT_SYNC_UNAVAILABLE'))),
    CHECK(resolved_at IS NULL OR resolved_at>=created_at),
    CHECK((resolved_at IS NULL AND resolution_outcome IS NULL) OR (resolved_at IS NOT NULL AND resolution_outcome IS NOT NULL))
);
CREATE INDEX product_master_sync_notification_open ON public.product_master_sync_notifications(store_id,created_at DESC)
    WHERE outcome<>'succeeded' AND resolved_at IS NULL;
ALTER TABLE public.product_master_sync_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_master_sync_notifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_master_sync_notifications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.product_master_sync_notifications TO authenticated;
CREATE POLICY product_master_sync_notification_member_read ON public.product_master_sync_notifications FOR SELECT TO authenticated
    USING((SELECT private.can_access_store(store_id,ARRAY['manager','staff','viewer']::text[])));

CREATE FUNCTION public.record_product_master_sync_notification(
    p_attempt_id uuid,p_store_id integer,p_source text,p_outcome text,p_code text,p_run_id uuid,p_started_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.product_master_sync_notifications; v_now timestamptz := clock_timestamp();
BEGIN
    IF p_attempt_id IS NULL OR p_store_id IS NULL OR p_store_id NOT IN (6,7) OR p_source IS NULL OR p_source NOT IN ('manual','cron','recovery')
      OR p_outcome IS NULL OR p_outcome NOT IN ('succeeded','rejected','unknown') OR p_started_at IS NULL OR p_started_at>v_now+interval '1 minute'
      OR NOT ((p_outcome='succeeded' AND p_code IS NULL) OR (p_outcome='unknown' AND p_code IS NOT NULL AND p_code='PRODUCT_SYNC_UNKNOWN') OR
        (p_outcome='rejected' AND p_code IS NOT NULL AND p_code IN ('PRODUCT_SYNC_PENDING_EDIT','PRODUCT_SYNC_PENDING_SYNC','PRODUCT_SYNC_STALE','PRODUCT_SYNC_INVALID_DATA',
          'PRODUCT_SYNC_EXPIRED','PRODUCT_SYNC_DISABLED','PRODUCT_SYNC_UNAVAILABLE'))) THEN
        RAISE EXCEPTION 'invalid notification' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid notification store' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(61005121,p_store_id);
    SELECT * INTO v_row FROM public.product_master_sync_notifications WHERE attempt_id=p_attempt_id AND store_id=p_store_id;
    IF FOUND THEN
        IF v_row.source='recovery' AND v_row.outcome='unknown' AND v_row.run_id=p_run_id AND p_attempt_id=p_run_id
          AND p_source IN ('manual','cron') THEN
            -- 通信待機中に別画面が検出した履歴も保持する。完了ACKだけではなくDB適用正本を照合する。
            IF p_outcome='succeeded' AND v_row.resolved_at IS NULL AND EXISTS(SELECT 1 FROM public.product_master_sync_runs
              WHERE id=p_run_id AND store_id=p_store_id AND state='applied') THEN
                UPDATE public.product_master_sync_notifications SET resolved_at=clock_timestamp(),resolution_outcome='succeeded'
                  WHERE attempt_id=p_attempt_id AND store_id=p_store_id;
            END IF;
            RETURN jsonb_build_object('recorded',true);
        END IF;
        IF v_row.source<>p_source OR v_row.outcome<>p_outcome OR v_row.code IS DISTINCT FROM p_code OR v_row.run_id IS DISTINCT FROM p_run_id THEN
            RAISE EXCEPTION 'notification conflict' USING ERRCODE='22023';
        END IF;
        RETURN jsonb_build_object('recorded',true);
    END IF;
    INSERT INTO public.product_master_sync_notifications(attempt_id,store_id,source,outcome,code,run_id,started_at)
      VALUES(p_attempt_id,p_store_id,p_source,p_outcome,p_code,p_run_id,p_started_at);
    IF p_outcome='succeeded' THEN
        -- 実行開始後に発生した別の失敗と、結果不明の送信を新しい成功で隠さない。
        UPDATE public.product_master_sync_notifications SET resolved_at=v_now,resolution_outcome='succeeded'
          WHERE store_id=p_store_id AND outcome='rejected' AND resolved_at IS NULL AND created_at<=p_started_at;
    END IF;
    RETURN jsonb_build_object('recorded',true);
END $$;

CREATE FUNCTION public.get_product_master_sync_notification_gate(p_store_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_notice public.product_master_sync_notifications; v_state jsonb;
BEGIN
    IF p_store_id IS NULL OR p_store_id NOT IN (6,7) THEN RAISE EXCEPTION 'invalid notification store' USING ERRCODE='22023'; END IF;
    -- 同期開始・適用・照会と同じ店舗版→通知→runの順でlockする。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid notification store' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(61005121,p_store_id);
    -- Nextの中断等で結果通知が未保存でも、同じrunの存在から発見する。送信元は推測しない。
    INSERT INTO public.product_master_sync_notifications(attempt_id,store_id,source,outcome,code,run_id,started_at)
      SELECT run.id,run.store_id,'recovery','unknown','PRODUCT_SYNC_UNKNOWN',run.id,run.started_at
      FROM public.product_master_sync_runs AS run WHERE run.store_id=p_store_id AND run.state='pending'
        AND NOT EXISTS(SELECT 1 FROM public.product_master_sync_notifications AS notice WHERE notice.store_id=run.store_id
          AND (notice.attempt_id=run.id OR notice.run_id=run.id)) ON CONFLICT(attempt_id,store_id) DO NOTHING;
    FOR v_notice IN SELECT * FROM public.product_master_sync_notifications WHERE store_id=p_store_id
      AND outcome='unknown' AND resolved_at IS NULL AND run_id IS NOT NULL FOR UPDATE LOOP
        IF to_regprocedure('public.get_product_master_sync_request(integer,uuid)') IS NOT NULL THEN
            -- 未受付の照会は同じUUIDの遅延開始権を閉じる。単純なnot-foundだけでは解消しない。
            v_state := public.get_product_master_sync_request(p_store_id,v_notice.run_id);
            IF v_state->>'storeId'=p_store_id::text AND v_state->>'requestId'=v_notice.run_id::text AND v_state->>'terminal'='true'
              AND ((v_state->>'state'='applied' AND v_state->>'success'='true') OR
                (v_state->>'state'='rejected' AND v_state->>'success'='false' AND v_state->>'outcome'='rejected')) THEN
                UPDATE public.product_master_sync_notifications SET resolved_at=clock_timestamp(),
                  resolution_outcome=CASE WHEN v_state->>'state'='applied' THEN 'succeeded' ELSE 'rejected' END
                  WHERE attempt_id=v_notice.attempt_id AND store_id=p_store_id;
            END IF;
        ELSIF EXISTS(SELECT 1 FROM public.product_master_sync_runs WHERE id=v_notice.run_id AND store_id=p_store_id AND state='applied') THEN
            UPDATE public.product_master_sync_notifications SET resolved_at=clock_timestamp(),resolution_outcome='succeeded'
              WHERE attempt_id=v_notice.attempt_id AND store_id=p_store_id;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('blocked',EXISTS(SELECT 1 FROM public.product_master_sync_notifications
      WHERE store_id=p_store_id AND outcome='unknown' AND resolved_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.record_product_master_sync_notification(uuid,integer,text,text,text,uuid,timestamptz),
  public.get_product_master_sync_notification_gate(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_product_master_sync_notification(uuid,integer,text,text,text,uuid,timestamptz),
  public.get_product_master_sync_notification_gate(integer) TO service_role;
