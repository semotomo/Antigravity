import unittest
from pathlib import Path
import shutil

from flet_app.core.sales.unmatched_export import (
    PRODUCT_SEED_FIELDS,
    TEMPLATE_FIELDS,
    build_alias_import_rows,
    build_product_seed_rows,
    estimate_service_selling_price,
    infer_service_product_group,
    build_unmatched_summary_sql,
    export_unmatched_sales_reports,
    extract_json_payload,
)


class UnmatchedSalesExportTests(unittest.TestCase):
    def test_build_unmatched_summary_sql_supports_optional_limit(self):
        sql = build_unmatched_summary_sql(limit=25)

        self.assertIn("FROM public.sales_enriched_v", sql)
        self.assertIn("WHERE unmatched_master = TRUE", sql)
        self.assertIn("GROUP BY product_name", sql)
        self.assertIn("LIMIT 25", sql)

    def test_build_alias_import_rows_preserves_alias_name_and_defaults(self):
        rows = build_alias_import_rows(
            [
                {
                    "alias_name": "爪切りのみ",
                    "sale_rows": 17,
                    "total_quantity": 53,
                    "total_sales_amount": "43034.00",
                    "first_sale_date": "2026-03-01",
                    "last_sale_date": "2026-03-18",
                    "distinct_store_count": 2,
                }
            ]
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["alias_name"], "爪切りのみ")
        self.assertEqual(rows[0]["product_id"], "")
        self.assertEqual(rows[0]["source_system"], "pos")
        self.assertTrue(rows[0]["is_active"])
        self.assertEqual(rows[0]["candidate_sale_rows"], 17)

    def test_infer_service_product_group_handles_major_patterns(self):
        self.assertEqual(infer_service_product_group("爪切りのみ"), "オプション")
        self.assertEqual(infer_service_product_group("送迎料"), "送迎")
        self.assertEqual(infer_service_product_group("犬（超小型）１〜５ｋｇ"), "トリミング")
        self.assertEqual(infer_service_product_group("犬（超小型）１〜５ｋｇ（一時預かり）"), "ホテル")

    def test_estimate_service_selling_price_uses_total_quantity(self):
        selling_price = estimate_service_selling_price(
            {
                "sale_rows": 17,
                "total_quantity": 53,
                "total_sales_amount": "43034.00",
            }
        )

        self.assertEqual(selling_price, 812)

    def test_build_product_seed_rows_creates_review_ready_master_template_fields(self):
        rows = build_product_seed_rows(
            [
                {
                    "alias_name": "爪切りのみ",
                    "sale_rows": 17,
                    "total_quantity": 53,
                    "total_sales_amount": "43034.00",
                    "first_sale_date": "2026-03-01",
                    "last_sale_date": "2026-03-18",
                    "distinct_store_count": 2,
                }
            ]
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["product_name"], "爪切りのみ")
        self.assertEqual(rows[0]["jan_code"], "")
        self.assertEqual(rows[0]["category"], "サービス")
        self.assertEqual(rows[0]["product_group"], "オプション")
        self.assertEqual(rows[0]["cost_price"], 0)
        self.assertEqual(rows[0]["selling_price"], 812)
        self.assertEqual(rows[0]["candidate_sale_rows"], 17)

    def test_extract_json_payload_ignores_cli_noise(self):
        output = '[{"alias_name":"爪切りのみ","sale_rows":17}]\nInitialising login role...\n'

        payload = extract_json_payload(output)

        self.assertEqual(payload[0]["alias_name"], "爪切りのみ")
        self.assertEqual(payload[0]["sale_rows"], 17)

    def test_export_unmatched_sales_reports_writes_summary_and_template_files(self):
        summary_rows = [
            {
                "alias_name": "爪切りのみ",
                "sale_rows": 17,
                "total_quantity": 17,
                "total_sales_amount": "43034.00",
                "first_sale_date": "2026-03-01",
                "last_sale_date": "2026-03-18",
                "distinct_store_count": 2,
            },
            {
                "alias_name": "足裏バリカン",
                "sale_rows": 9,
                "total_quantity": 9,
                "total_sales_amount": "6090.00",
                "first_sale_date": "2026-03-03",
                "last_sale_date": "2026-03-18",
                "distinct_store_count": 1,
            },
        ]

        def fake_runner(sql: str):
            self.assertIn("sales_enriched_v", sql)
            return summary_rows

        output_dir = Path("tests/.tmp/unmatched_export_case")
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        artifacts = export_unmatched_sales_reports(
            query_runner=fake_runner,
            output_dir=output_dir,
            limit=50,
        )

        self.assertTrue(artifacts.summary_csv.exists())
        self.assertTrue(artifacts.alias_template_csv.exists())
        self.assertTrue(artifacts.product_seed_csv.exists())
        self.assertTrue(artifacts.summary_json.exists())
        self.assertEqual(artifacts.row_count, 2)

        summary_text = artifacts.summary_csv.read_text(encoding="utf-8-sig")
        self.assertIn("alias_name", summary_text)
        self.assertIn("爪切りのみ", summary_text)

        template_text = artifacts.alias_template_csv.read_text(encoding="utf-8-sig")
        self.assertIn(",".join(TEMPLATE_FIELDS), template_text.splitlines()[0])
        self.assertIn("source_system", template_text)
        self.assertIn("足裏バリカン", template_text)

        product_seed_text = artifacts.product_seed_csv.read_text(encoding="utf-8-sig")
        self.assertIn(",".join(PRODUCT_SEED_FIELDS), product_seed_text.splitlines()[0])
        self.assertIn("爪切りのみ", product_seed_text)

        shutil.rmtree(output_dir)


if __name__ == "__main__":
    unittest.main()
