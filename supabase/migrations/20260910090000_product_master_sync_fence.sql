-- CSV取得中の編集を検知する店舗版番号。既存商品・棚卸しの値は移行時に変更しない。
CREATE TABLE public.product_master_store_versions (
    store_id integer PRIMARY KEY REFERENCES public.stores(id) CHECK(store_id IN (6,7)),
    revision bigint NOT NULL DEFAULT 0 CHECK(revision >= 0)
);
INSERT INTO public.product_master_store_versions(store_id) VALUES(6),(7);
CREATE TABLE public.product_master_sync_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id integer NOT NULL REFERENCES public.product_master_store_versions(store_id),
    revision bigint NOT NULL,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
    state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied')),
    source_hash text CHECK(source_hash ~ '^[0-9a-f]{64}$'),
    result jsonb,
    finished_at timestamptz
);
ALTER TABLE public.product_master_store_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_master_store_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_master_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_master_sync_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_master_store_versions,public.product_master_sync_runs FROM PUBLIC,anon,authenticated,service_role;

-- 外部の通常編集・旧同期・商品移管も検知。店舗移管では両店舗を固定順で更新する。
CREATE FUNCTION private.bump_product_master_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old integer; v_new integer; v_store integer;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_old := OLD.store_id; END IF;
    IF TG_OP <> 'DELETE' THEN v_new := NEW.store_id; END IF;
    FOR v_store IN SELECT DISTINCT s FROM unnest(ARRAY[v_old,v_new]) s WHERE s IN (6,7) ORDER BY s LOOP
        UPDATE public.product_master_store_versions SET revision=revision+1 WHERE store_id=v_store;
    END LOOP;
    RETURN NULL;
END $$;
CREATE TRIGGER product_master_revision AFTER INSERT OR UPDATE OR DELETE ON public.products
    FOR EACH ROW EXECUTE FUNCTION private.bump_product_master_revision();
-- 受付後に取消しになっても、受付前のCSVを新しい商品情報とみなさない。
CREATE TRIGGER pos_operation_master_revision AFTER INSERT ON public.pos_product_operations
    FOR EACH ROW EXECUTE FUNCTION private.bump_product_master_revision();
REVOKE ALL ON FUNCTION private.bump_product_master_revision() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.begin_product_master_sync(p_store_id integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision bigint; v_run public.product_master_sync_runs;
BEGIN
    SELECT revision INTO v_revision FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid sync store' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE store_id=p_store_id AND status NOT IN ('completed','rejected')) THEN
        RAISE EXCEPTION 'pending product operation' USING ERRCODE='55000';
    END IF;
    INSERT INTO public.product_master_sync_runs(store_id,revision) VALUES(p_store_id,v_revision) RETURNING * INTO v_run;
    RETURN jsonb_build_object('id',v_run.id,'storeId',p_store_id,'startedAt',v_run.started_at);
END $$;

CREATE FUNCTION public.apply_product_master_sync(p_run_id uuid,p_store_id integer,p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='30s' AS $$
DECLARE v_run public.product_master_sync_runs; v_revision bigint; v_hash text; v_row jsonb;
    v_count integer; v_inactivated integer; v_now timestamptz; v_tag text;
BEGIN
    -- 商品行を操作する前に店舗版を固定する。競合した通常編集は待機またはtransaction失敗となる。
    SELECT revision INTO v_revision FROM public.product_master_store_versions WHERE store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid sync store' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_run FROM public.product_master_sync_runs WHERE id=p_run_id AND store_id=p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'sync unavailable' USING ERRCODE='22023'; END IF;
    IF p_records IS NULL OR jsonb_typeof(p_records)<>'array' OR octet_length(p_records::text)>5000000 THEN
        RAISE EXCEPTION 'invalid sync records' USING ERRCODE='22023';
    END IF;
    v_count := jsonb_array_length(p_records);
    IF v_count NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid sync count' USING ERRCODE='22023'; END IF;
    v_hash := encode(sha256(convert_to(p_records::text,'UTF8')),'hex');
    IF v_run.state='applied' THEN
        IF v_run.source_hash<>v_hash THEN RAISE EXCEPTION 'sync content conflict' USING ERRCODE='22023'; END IF;
        RETURN v_run.result;
    END IF;
    IF v_run.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'sync expired' USING ERRCODE='55000'; END IF;
    IF v_run.revision<>v_revision THEN RAISE EXCEPTION 'stale sync' USING ERRCODE='40001'; END IF;
    IF EXISTS(SELECT 1 FROM public.pos_product_operations WHERE store_id=p_store_id AND status NOT IN ('completed','rejected')) THEN
        RAISE EXCEPTION 'pending product operation' USING ERRCODE='55000';
    END IF;
    v_tag := CASE p_store_id WHEN 6 THEN 'わんわん' ELSE '本店' END;
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_records) LOOP
        IF jsonb_typeof(v_row)<>'object' OR NOT v_row ?& ARRAY['store_id','jan_code','product_name','category','product_group','cost_price','selling_price','markup_rate','is_active','tags']
            OR v_row - ARRAY['store_id','jan_code','product_name','category','product_group','cost_price','selling_price','markup_rate','is_active','tags'] <> '{}'::jsonb
            OR v_row->'store_id'<>to_jsonb(p_store_id) OR v_row->'is_active'<>'true'::jsonb OR v_row->>'tags' IS DISTINCT FROM v_tag THEN
            RAISE EXCEPTION 'invalid sync fields' USING ERRCODE='22023';
        END IF;
        -- CSVには社内コードも存在するため、新規登録用JANの桁制約を既存同期へ流用しない。
        IF jsonb_typeof(v_row->'jan_code')<>'string' OR length(btrim(v_row->>'jan_code')) NOT BETWEEN 1 AND 100
            OR jsonb_typeof(v_row->'product_name')<>'string' OR length(btrim(v_row->>'product_name')) NOT BETWEEN 1 AND 1000
            OR jsonb_typeof(v_row->'category')<>'string' OR length(v_row->>'category')>1000
            OR jsonb_typeof(v_row->'product_group') NOT IN ('string','null')
            OR length(coalesce(v_row->>'product_group',''))>1000
            OR jsonb_typeof(v_row->'cost_price')<>'number' OR (v_row->>'cost_price') !~ '^\d{1,9}$'
            OR jsonb_typeof(v_row->'selling_price')<>'number' OR (v_row->>'selling_price') !~ '^\d{1,9}$'
            OR jsonb_typeof(v_row->'markup_rate')<>'number' THEN
            RAISE EXCEPTION 'invalid sync values' USING ERRCODE='22023';
        END IF;
    END LOOP;
    IF (SELECT count(DISTINCT value->>'jan_code') FROM jsonb_array_elements(p_records))<>v_count THEN
        RAISE EXCEPTION 'duplicate sync JAN' USING ERRCODE='22023';
    END IF;
    v_now := clock_timestamp();
    INSERT INTO public.products(store_id,jan_code,product_name,category,product_group,cost_price,selling_price,markup_rate,is_active,tags,updated_at)
        SELECT p_store_id,r.jan_code,r.product_name,r.category,r.product_group,r.cost_price,r.selling_price,
            CASE WHEN r.selling_price>0 THEN round((r.selling_price-r.cost_price)/r.selling_price,4) ELSE 0 END,
            true,v_tag,v_now
        FROM jsonb_to_recordset(p_records) AS r(jan_code text,product_name text,category text,product_group text,cost_price numeric,selling_price numeric)
        ON CONFLICT(store_id,jan_code) DO UPDATE SET product_name=EXCLUDED.product_name,category=EXCLUDED.category,
            product_group=EXCLUDED.product_group,cost_price=EXCLUDED.cost_price,selling_price=EXCLUDED.selling_price,
            markup_rate=EXCLUDED.markup_rate,is_active=true,tags=EXCLUDED.tags,updated_at=EXCLUDED.updated_at;
    -- 既存の手動停止triggerを通す。ブランド等のローカル専用列・棚卸し数量は触らない。
    UPDATE public.products p SET is_active=false
        WHERE p.store_id=p_store_id AND p.is_active=true
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_records) r WHERE r->>'jan_code'=p.jan_code);
    GET DIAGNOSTICS v_inactivated=ROW_COUNT;
    v_run.result := jsonb_build_object('success',true,'count',v_count,'deactivatedCount',v_inactivated,'syncStartedAt',v_run.started_at);
    UPDATE public.product_master_sync_runs SET state='applied',source_hash=v_hash,result=v_run.result,finished_at=v_now WHERE id=p_run_id;
    RETURN v_run.result;
END $$;
REVOKE ALL ON FUNCTION public.begin_product_master_sync(integer),public.apply_product_master_sync(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_product_master_sync(integer),public.apply_product_master_sync(uuid,integer,jsonb) TO service_role;
