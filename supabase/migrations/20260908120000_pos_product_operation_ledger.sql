-- 商品POS連動 P1c。操作台帳だけを追加し、商品・棚卸し・権限データは変更しない。
CREATE TABLE public.pos_product_operations (
    id UUID PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT CHECK (store_id IN (6,7)),
    actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('create','update')),
    -- 監査用IDは将来の削除後も保存する。所属は下記triggerで検証し、その後変更不可。
    product_id_snapshot INTEGER,
    jan_code TEXT NOT NULL CHECK (jan_code ~ '^(\d{8}|\d{12}|\d{13})$'),
    pos_product_id TEXT,
    command_text TEXT NOT NULL CHECK (octet_length(command_text) <= 16384),
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    expected_result_fingerprint TEXT NOT NULL CHECK (expected_result_fingerprint ~ '^[0-9a-f]{64}$'),
    verified_fingerprint TEXT,
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN
        ('prepared','dispatching','verifying','uncertain','pos_confirmed','db_pending','completed','rejected')),
    send_attempts INTEGER NOT NULL DEFAULT 0 CHECK (send_attempts IN (0,1)),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version BETWEEN 0 AND 9007199254740991),
    last_event TEXT NOT NULL DEFAULT 'prepared',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    dispatch_expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '15 minutes',
    UNIQUE (id,store_id),
    CHECK ((kind='create' AND product_id_snapshot IS NULL AND pos_product_id IS NULL)
        OR (kind='update' AND product_id_snapshot IS NOT NULL AND product_id_snapshot > 0
            AND pos_product_id IS NOT NULL AND length(pos_product_id) BETWEEN 1 AND 128)),
    CHECK (payload_hash = encode(sha256(convert_to(command_text,'UTF8')),'hex')),
    CHECK ((status IN ('prepared','rejected') AND send_attempts=0)
        OR (status NOT IN ('prepared','rejected') AND send_attempts=1)),
    CHECK ((status IN ('pos_confirmed','db_pending','completed') AND verified_fingerprint IS NOT NULL
            AND verified_fingerprint=expected_result_fingerprint)
        OR (status NOT IN ('pos_confirmed','db_pending','completed') AND verified_fingerprint IS NULL))
);

-- 未完了操作のJANと商品IDを予約する。結果不明では自動解放しない。
CREATE TABLE public.pos_product_operation_locks (
    store_id INTEGER NOT NULL CHECK (store_id IN (6,7)),
    resource_key TEXT NOT NULL CHECK (resource_key ~ '^(jan:[0-9]{8,13}|product:[0-9]+)$'),
    operation_id UUID NOT NULL,
    PRIMARY KEY (store_id,resource_key),
    FOREIGN KEY (operation_id,store_id) REFERENCES public.pos_product_operations(id,store_id) ON DELETE RESTRICT
);
CREATE INDEX pos_product_operation_locks_operation_idx ON public.pos_product_operation_locks(operation_id);
CREATE INDEX pos_product_operations_owner_idx ON public.pos_product_operations(actor_id,store_id,created_at DESC);
CREATE INDEX pos_product_operations_pending_idx ON public.pos_product_operations(store_id,status)
    WHERE status NOT IN ('completed','rejected');

CREATE TABLE public.pos_product_operation_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id UUID NOT NULL,
    store_id INTEGER NOT NULL,
    actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    row_version BIGINT NOT NULL,
    event_name TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (operation_id,row_version),
    FOREIGN KEY (operation_id,store_id) REFERENCES public.pos_product_operations(id,store_id) ON DELETE RESTRICT
);

CREATE FUNCTION private.guard_pos_product_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status <> 'prepared' OR NEW.row_version <> 0 OR NEW.last_event <> 'prepared' THEN
            RAISE EXCEPTION 'invalid initial operation' USING ERRCODE='22023';
        END IF;
        IF NEW.kind='update' AND NOT EXISTS (
            SELECT 1 FROM public.products p WHERE p.id=NEW.product_id_snapshot
              AND p.store_id=NEW.store_id AND p.jan_code=NEW.jan_code
        ) THEN
            RAISE EXCEPTION 'product unavailable' USING ERRCODE='23514';
        END IF;
    ELSE
        IF (to_jsonb(NEW) - ARRAY['status','send_attempts','row_version','last_event','updated_at','verified_fingerprint'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','send_attempts','row_version','last_event','updated_at','verified_fingerprint'])
            OR NEW.row_version <> OLD.row_version+1 THEN
            RAISE EXCEPTION 'operation identity is immutable' USING ERRCODE='22023';
        END IF;
        -- 呼出側だけでなくDBでも遷移を固定する。商品反映RPC導入前は完了へ遷移しない。
        IF NOT (
            (OLD.status='prepared' AND NEW.status='dispatching' AND NEW.last_event='claim_dispatch')
            OR (OLD.status='prepared' AND NEW.status='rejected' AND NEW.last_event='reject_before_dispatch')
            OR (OLD.status='dispatching' AND NEW.status='verifying' AND NEW.last_event='dispatch_returned')
            OR (OLD.status IN ('dispatching','verifying','uncertain') AND NEW.status='uncertain' AND NEW.last_event='outcome_unknown')
            OR (OLD.status IN ('verifying','uncertain') AND NEW.status='pos_confirmed' AND NEW.last_event='pos_verified')
            OR (OLD.status IN ('pos_confirmed','db_pending') AND NEW.status='db_pending' AND NEW.last_event='db_failed')
        ) THEN RAISE EXCEPTION 'invalid transition' USING ERRCODE='22023'; END IF;
        NEW.updated_at := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION private.audit_pos_product_operation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    INSERT INTO public.pos_product_operation_events(operation_id,store_id,actor_id,row_version,event_name,previous_status,new_status)
    VALUES (NEW.id,NEW.store_id,NEW.actor_id,NEW.row_version,NEW.last_event,
        CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status);
    RETURN NEW;
END $$;
CREATE FUNCTION private.prevent_pos_product_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    RAISE EXCEPTION 'POS product audit is append only' USING ERRCODE='42501';
END $$;

CREATE TRIGGER pos_product_operation_guard BEFORE INSERT OR UPDATE ON public.pos_product_operations
    FOR EACH ROW EXECUTE FUNCTION private.guard_pos_product_operation();
CREATE TRIGGER pos_product_operation_audit AFTER INSERT OR UPDATE ON public.pos_product_operations
    FOR EACH ROW EXECUTE FUNCTION private.audit_pos_product_operation();
CREATE TRIGGER pos_product_operation_no_delete BEFORE DELETE ON public.pos_product_operations
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_operation_no_truncate BEFORE TRUNCATE ON public.pos_product_operations
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_event_immutable BEFORE UPDATE OR DELETE ON public.pos_product_operation_events
    FOR EACH ROW EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();
CREATE TRIGGER pos_product_event_no_truncate BEFORE TRUNCATE ON public.pos_product_operation_events
    FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_pos_product_audit_mutation();

ALTER TABLE public.pos_product_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_operation_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_operation_locks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_product_operation_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.pos_product_operations, public.pos_product_operation_locks,
    public.pos_product_operation_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.pos_product_operation_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pos_product_operations, public.pos_product_operation_events TO authenticated;
CREATE POLICY pos_product_operation_owner_read ON public.pos_product_operations FOR SELECT TO authenticated
    USING (actor_id=(SELECT auth.uid()) AND (SELECT private.can_access_store(store_id,ARRAY['manager']::TEXT[])));
CREATE POLICY pos_product_event_owner_read ON public.pos_product_operation_events FOR SELECT TO authenticated
    USING (actor_id=(SELECT auth.uid()) AND (SELECT private.can_access_store(store_id,ARRAY['manager']::TEXT[])));

REVOKE ALL ON FUNCTION private.guard_pos_product_operation(), private.audit_pos_product_operation(),
    private.prevent_pos_product_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;
