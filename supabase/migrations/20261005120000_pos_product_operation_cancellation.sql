-- 未送信の通常編集だけを取消する。未作成IDにも不変の墓標を残し、遅延受付を拒否する。
CREATE TABLE public.pos_product_operation_cancellations (
    operation_id uuid PRIMARY KEY,
    store_id integer NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT CHECK(store_id IN (6,7)),
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    product_id_snapshot integer NOT NULL CHECK(product_id_snapshot>0),
    reason text NOT NULL CHECK(reason IN ('cancel_prepared','cancel_before_preparation')),
    cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.pos_product_operation_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_operation_cancellations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_product_operation_cancellations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos_product_cancellation_immutable BEFORE UPDATE OR DELETE ON public.pos_product_operation_cancellations
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_cancellation_no_truncate BEFORE TRUNCATE ON public.pos_product_operation_cancellations
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

CREATE FUNCTION private.reject_cancelled_pos_product_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    -- 全受付経路に効かせる。存在しないIDの取消とINSERTも同じ排他キーで直列化する。
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-operation:'||NEW.id::text,0));
    IF EXISTS(SELECT 1 FROM public.pos_product_operation_cancellations WHERE operation_id=NEW.id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER pos_product_cancelled_operation_guard BEFORE INSERT ON public.pos_product_operations
    FOR EACH ROW EXECUTE FUNCTION private.reject_cancelled_pos_product_operation();

CREATE FUNCTION public.get_pos_product_edit_recovery_state(p_actor_id uuid,p_store_id integer,p_product_id integer,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; c public.pos_product_operation_cancellations;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    -- 読取りも店舗→商品/操作の順を共有し、applyの店舗→操作→商品と競合させない。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023'; END IF;
    IF p_product_id IS NULL OR p_product_id<=0 OR p_operation_id IS NULL THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.products WHERE id=p_product_id AND store_id=p_store_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='42501'; END IF;
    SELECT * INTO op FROM public.pos_product_operations WHERE id=p_operation_id FOR SHARE;
    IF FOUND AND (op.actor_id<>p_actor_id OR op.store_id<>p_store_id OR op.kind<>'update' OR op.product_id_snapshot<>p_product_id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO c FROM public.pos_product_operation_cancellations WHERE operation_id=p_operation_id;
    IF FOUND AND (c.actor_id<>p_actor_id OR c.store_id<>p_store_id OR c.product_id_snapshot<>p_product_id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='42501';
    END IF;
    -- 救済UUIDの誤入力で、同商品に残る別の進行中操作を迂回させない。
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE actor_id=p_actor_id AND store_id=p_store_id
        AND product_id_snapshot=p_product_id AND id<>p_operation_id AND status NOT IN ('completed','rejected')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
    END IF;
    -- terminalだけでなく予約解放も検証する。notfoundは取消済みとはみなさない。
    IF (c.operation_id IS NOT NULL OR op.status IN ('completed','rejected')) AND
        (EXISTS(SELECT 1 FROM public.pos_product_operation_locks WHERE operation_id=p_operation_id)
         OR (c.operation_id IS NOT NULL AND op.id IS NOT NULL AND (op.status<>'rejected' OR op.send_attempts<>0))) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('operation',CASE WHEN op.id IS NULL THEN NULL ELSE to_jsonb(op) END,
        'cancellation',CASE WHEN c.operation_id IS NULL THEN NULL ELSE to_jsonb(c) END);
END $$;

CREATE FUNCTION public.cancel_pos_product_edit(p_actor_id uuid,p_store_id integer,p_product_id integer,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.pos_product_operations; c public.pos_product_operation_cancellations;
BEGIN
    PERFORM private.assert_pos_product_manager(p_actor_id,p_store_id);
    IF p_product_id IS NULL OR p_product_id<=0 OR p_operation_id IS NULL THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
    END IF;
    -- prepare_edit/apply/syncと同じ店舗行を最初に取得し、その後ID排他→操作行。
    PERFORM 1 FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-product-operation:'||p_operation_id::text,0));
    SELECT * INTO op FROM public.pos_product_operations WHERE id=p_operation_id FOR UPDATE;
    IF FOUND AND (op.actor_id<>p_actor_id OR op.store_id<>p_store_id OR op.kind<>'update' OR op.product_id_snapshot<>p_product_id) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.products WHERE id=p_product_id AND store_id=p_store_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE actor_id=p_actor_id AND store_id=p_store_id
        AND product_id_snapshot=p_product_id AND id<>p_operation_id AND status NOT IN ('completed','rejected')) THEN
        RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
    END IF;
    SELECT * INTO c FROM public.pos_product_operation_cancellations WHERE operation_id=p_operation_id;
    IF FOUND THEN
        IF c.actor_id<>p_actor_id OR c.store_id<>p_store_id OR c.product_id_snapshot<>p_product_id THEN
            RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='42501';
        END IF;
        RETURN public.get_pos_product_edit_recovery_state(p_actor_id,p_store_id,p_product_id,p_operation_id);
    END IF;
    IF op.id IS NOT NULL THEN
        IF op.status<>'prepared' OR op.send_attempts<>0 OR
            EXISTS(SELECT 1 FROM public.pos_product_edit_dispatch_receipts WHERE operation_id=op.id) THEN
            RAISE EXCEPTION 'POS_PRODUCT_CANCELLATION_REJECTED' USING ERRCODE='22023';
        END IF;
        UPDATE public.pos_product_operations SET status='rejected',row_version=row_version+1,last_event='reject_before_dispatch'
            WHERE id=op.id RETURNING * INTO op;
        DELETE FROM public.pos_product_operation_locks WHERE operation_id=op.id;
    END IF;
    INSERT INTO public.pos_product_operation_cancellations(operation_id,store_id,actor_id,product_id_snapshot,reason)
        VALUES(p_operation_id,p_store_id,p_actor_id,p_product_id,CASE WHEN op.id IS NULL THEN 'cancel_before_preparation' ELSE 'cancel_prepared' END);
    RETURN public.get_pos_product_edit_recovery_state(p_actor_id,p_store_id,p_product_id,p_operation_id);
END $$;

REVOKE ALL ON FUNCTION private.reject_cancelled_pos_product_operation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_pos_product_edit(uuid,integer,integer,uuid),public.get_pos_product_edit_recovery_state(uuid,integer,integer,uuid)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pos_product_edit(uuid,integer,integer,uuid),public.get_pos_product_edit_recovery_state(uuid,integer,integer,uuid)
    TO service_role;
