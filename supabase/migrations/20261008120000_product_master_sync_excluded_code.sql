-- 共通コード999999はCSV同期の対象外。既存商品・棚卸し参照・active状態は変更しない。
-- 過去migrationを書き換えず、未取得商品の自動停止を無効化したRPCへ入力拒否だけ追加する。
DO $excluded_code$
DECLARE v_definition text; v_original text; v_unchanged text; v_guard text;
BEGIN
    v_definition := pg_get_functiondef('public.apply_product_master_sync(uuid,integer,jsonb)'::regprocedure);
    v_definition := replace(v_definition,E'\r\n',E'\n');
    v_original := E'    v_hash := encode(sha256(convert_to(p_records::text,''UTF8'')),''hex'');';
    v_unchanged := E'    -- 欠落商品は変更しない。完全性の証拠を確認した別操作でのみ停止する。\n    v_inactivated := 0;';
    -- 既知の切替後関数だけを変更する。旧停止処理が残った関数には適用しない。
    IF (length(v_definition)-length(replace(v_definition,v_original,'')))/length(v_original) <> 1
        OR (length(v_definition)-length(replace(v_definition,v_unchanged,'')))/length(v_unchanged) <> 1
        OR strpos(v_definition,'UPDATE public.products') > 0 THEN
        RAISE EXCEPTION 'product sync excluded code source mismatch' USING ERRCODE='55000';
    END IF;
    v_guard := $guard$    -- GASと同じ空白除去・全角数字変換・末尾.0除去後の共通コードを拒否する。
    -- 適用済み結果の早期返却より前に検査し、再混入した入力を成功扱いしない。
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_records) AS record(value)
        WHERE regexp_replace(
            translate(
                btrim(record.value->>'jan_code',
                    U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'),
                '０１２３４５６７８９','0123456789'),
            '\.0$','') = '999999'
    ) THEN
        RAISE EXCEPTION 'invalid sync values' USING ERRCODE='22023';
    END IF;
$guard$;
    EXECUTE replace(v_definition,v_original,v_guard || v_original);
END $excluded_code$;
