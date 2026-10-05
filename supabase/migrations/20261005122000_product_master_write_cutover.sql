-- 商品マスタだけをRPC専用に切り替える。売上・履歴・棚卸しのACLや数量は変更しない。
-- 完全なCSVである証拠が未確立のため、欠落JANを理由にした自動停止は行わない。
DO $cutover$
DECLARE v_definition text; v_original text; v_column record; v_sequence text;
BEGIN
    v_definition := pg_get_functiondef('public.apply_product_master_sync(uuid,integer,jsonb)'::regprocedure);
    v_definition := replace(v_definition,E'\r\n',E'\n');
    v_original := E'    UPDATE public.products p SET is_active=false\n        WHERE p.store_id=p_store_id AND p.is_active=true\n          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_records) r WHERE r->>''jan_code''=p.jan_code);\n    GET DIAGNOSTICS v_inactivated=ROW_COUNT;';
    -- 未確認の本番関数を部分的に書き換えない。既知の旧ブロックが一度だけ存在することを確認する。
    IF (length(v_definition)-length(replace(v_definition,v_original,'')))/length(v_original) <> 1 THEN
        RAISE EXCEPTION 'product sync cutover source mismatch' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(v_definition,v_original,
        E'    -- 欠落商品は変更しない。完全性の証拠を確認した別操作でのみ停止する。\n    v_inactivated := 0;');

    IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='products'
        AND policyname <> 'Allow all access to products') THEN
        RAISE EXCEPTION 'unexpected product policy; review before cutover' USING ERRCODE='55000';
    END IF;
    -- テーブルACLだけでなく、既存の列単位GRANTも残さない。
    FOR v_column IN SELECT attname FROM pg_attribute WHERE attrelid='public.products'::regclass
        AND attnum>0 AND NOT attisdropped LOOP
        EXECUTE format('REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON public.products FROM PUBLIC, anon, authenticated, service_role',v_column.attname);
    END LOOP;
    v_sequence := pg_get_serial_sequence('public.products','id');
    IF v_sequence IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',v_sequence::regclass);
    END IF;
END $cutover$;

REVOKE ALL ON public.products FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.products TO authenticated,service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all access to products" ON public.products;
CREATE POLICY products_member_read ON public.products FOR SELECT TO authenticated
    USING(private.can_access_store(store_id));
-- SECURITY DEFINERの管理者検証済み編集・同期・棚卸し停止RPCは、関数所有者で引き続き動作する。
