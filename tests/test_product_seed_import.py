import csv
import shutil
import unittest
from pathlib import Path

from flet_app.core.sales.product_seed_import import (
    AUTO_JAN_PREFIX,
    build_product_seed_upsert_sql,
    build_service_jan_code,
    import_products_from_seed,
    prepare_product_seed_rows,
)


class ProductSeedImportTests(unittest.TestCase):
    def test_prepare_product_seed_rows_generates_deterministic_jan_code_and_defaults(self):
        prepared = prepare_product_seed_rows(
            [
                {
                    "product_name": " 爪切りのみ ",
                    "jan_code": "",
                    "category": " サービス ",
                    "cost_price": "",
                    "selling_price": "800",
                    "is_active": "",
                }
            ]
        )

        self.assertEqual(prepared.skipped_rows, 0)
        self.assertEqual(prepared.errors, [])
        self.assertEqual(len(prepared.actionable_rows), 1)
        self.assertEqual(prepared.actionable_rows[0]["product_name"], "爪切りのみ")
        self.assertTrue(prepared.actionable_rows[0]["jan_code"].startswith(AUTO_JAN_PREFIX))
        self.assertEqual(prepared.actionable_rows[0]["category"], "サービス")
        self.assertEqual(prepared.actionable_rows[0]["cost_price"], 0)
        self.assertEqual(prepared.actionable_rows[0]["selling_price"], 800)
        self.assertTrue(prepared.actionable_rows[0]["is_active"])

    def test_prepare_product_seed_rows_detects_duplicate_product_name(self):
        prepared = prepare_product_seed_rows(
            [
                {"product_name": "爪切りのみ", "selling_price": "800"},
                {"product_name": "爪切りのみ", "selling_price": "900"},
            ]
        )

        self.assertEqual(len(prepared.errors), 1)
        self.assertIn("Duplicate product_name", prepared.errors[0])

    def test_build_service_jan_code_is_deterministic(self):
        jan_code_1 = build_service_jan_code("爪切りのみ")
        jan_code_2 = build_service_jan_code("爪切りのみ")

        self.assertEqual(jan_code_1, jan_code_2)
        self.assertTrue(jan_code_1.startswith(AUTO_JAN_PREFIX))

    def test_build_product_seed_upsert_sql_contains_update_and_conflict_clauses(self):
        sql = build_product_seed_upsert_sql(
            [
                {
                    "product_name": "爪切りのみ",
                    "jan_code": "svc:auto:test",
                    "jan_code_provided": False,
                    "category": "サービス",
                    "product_group": "グルーミング",
                    "brand": "",
                    "cost_price": 0,
                    "selling_price": 800,
                    "is_active": True,
                }
            ]
        )

        self.assertIn("UPDATE public.products", sql)
        self.assertIn("ON CONFLICT (jan_code)", sql)
        self.assertIn("jsonb_to_recordset", sql)
        self.assertIn("爪切りのみ", sql)

    def test_import_products_from_seed_dry_run_accepts_new_rows(self):
        temp_dir = Path("tests/.tmp/product_seed_import_case")
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        csv_path = temp_dir / "products.csv"
        with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=[
                    "product_name",
                    "jan_code",
                    "category",
                    "product_group",
                    "brand",
                    "cost_price",
                    "selling_price",
                    "is_active",
                ],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "product_name": "爪切りのみ",
                    "jan_code": "",
                    "category": "サービス",
                    "product_group": "グルーミング",
                    "brand": "",
                    "cost_price": "0",
                    "selling_price": "800",
                    "is_active": "true",
                }
            )

        calls: list[str] = []

        def fake_runner(sql: str):
            calls.append(sql)
            return []

        result = import_products_from_seed(csv_path=csv_path, query_runner=fake_runner, apply=False)

        self.assertTrue(result.dry_run)
        self.assertEqual(result.actionable_rows, 1)
        self.assertEqual(result.skipped_rows, 0)
        self.assertEqual(result.upserted_rows, 0)
        self.assertEqual(result.errors, [])
        self.assertEqual(len(calls), 1)

        shutil.rmtree(temp_dir)

    def test_import_products_from_seed_detects_existing_name_with_conflicting_manual_jan_code(self):
        temp_dir = Path("tests/.tmp/product_seed_import_conflict_case")
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        csv_path = temp_dir / "products.csv"
        with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=[
                    "product_name",
                    "jan_code",
                    "category",
                    "product_group",
                    "brand",
                    "cost_price",
                    "selling_price",
                    "is_active",
                ],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "product_name": "爪切りのみ",
                    "jan_code": "svc:manual:test",
                    "category": "サービス",
                    "product_group": "グルーミング",
                    "brand": "",
                    "cost_price": "0",
                    "selling_price": "800",
                    "is_active": "true",
                }
            )

        def fake_runner(sql: str):
            return [{"id": 12, "jan_code": "svc:auto:existing", "product_name": "爪切りのみ"}]

        result = import_products_from_seed(csv_path=csv_path, query_runner=fake_runner, apply=False)

        self.assertEqual(result.actionable_rows, 1)
        self.assertEqual(result.upserted_rows, 0)
        self.assertEqual(len(result.errors), 1)
        self.assertIn("already exists with jan_code", result.errors[0])

        shutil.rmtree(temp_dir)

    def test_import_products_from_seed_apply_returns_upserted_count(self):
        temp_dir = Path("tests/.tmp/product_seed_import_apply_case")
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        csv_path = temp_dir / "products.csv"
        with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=[
                    "product_name",
                    "jan_code",
                    "category",
                    "product_group",
                    "brand",
                    "cost_price",
                    "selling_price",
                    "is_active",
                ],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "product_name": "部分カット",
                    "jan_code": "",
                    "category": "サービス",
                    "product_group": "グルーミング",
                    "brand": "",
                    "cost_price": "0",
                    "selling_price": "1200",
                    "is_active": "true",
                }
            )

        def fake_runner(sql: str):
            if "FROM public.products p" in sql:
                return []
            return [{"upserted_count": 1}]

        result = import_products_from_seed(csv_path=csv_path, query_runner=fake_runner, apply=True)

        self.assertFalse(result.dry_run)
        self.assertEqual(result.actionable_rows, 1)
        self.assertEqual(result.upserted_rows, 1)
        self.assertEqual(result.errors, [])

        shutil.rmtree(temp_dir)


if __name__ == "__main__":
    unittest.main()
