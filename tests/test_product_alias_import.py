import csv
import shutil
import unittest
from pathlib import Path

from flet_app.core.sales.product_alias_import import (
    build_product_alias_upsert_sql,
    import_product_aliases,
    prepare_import_rows,
)


class ProductAliasImportTests(unittest.TestCase):
    def test_prepare_import_rows_defaults_values_and_skips_blank_product_id(self):
        prepared = prepare_import_rows(
            [
                {
                    "alias_name": " 爪切りのみ ",
                    "product_id": "12",
                    "source_system": "",
                    "is_active": "",
                },
                {
                    "alias_name": "プードル（Ｃ）",
                    "product_id": "",
                    "source_system": "pos",
                    "is_active": "True",
                },
            ]
        )

        self.assertEqual(prepared.skipped_rows, 1)
        self.assertEqual(prepared.errors, [])
        self.assertEqual(len(prepared.actionable_rows), 1)
        self.assertEqual(prepared.actionable_rows[0]["alias_name"], "爪切りのみ")
        self.assertEqual(prepared.actionable_rows[0]["product_id"], 12)
        self.assertEqual(prepared.actionable_rows[0]["source_system"], "pos")
        self.assertTrue(prepared.actionable_rows[0]["is_active"])

    def test_prepare_import_rows_detects_duplicate_alias_and_source(self):
        prepared = prepare_import_rows(
            [
                {"alias_name": "爪切りのみ", "product_id": "12", "source_system": "pos", "is_active": "true"},
                {"alias_name": "爪切りのみ", "product_id": "14", "source_system": "pos", "is_active": "true"},
            ]
        )

        self.assertEqual(len(prepared.errors), 1)
        self.assertIn("Duplicate alias", prepared.errors[0])

    def test_build_product_alias_upsert_sql_contains_conflict_clause(self):
        sql = build_product_alias_upsert_sql(
            [
                {
                    "alias_name": "爪切りのみ",
                    "product_id": 12,
                    "source_system": "pos",
                    "is_active": True,
                }
            ]
        )

        self.assertIn("jsonb_to_recordset", sql)
        self.assertIn("ON CONFLICT (alias_name, source_system)", sql)
        self.assertIn("爪切りのみ", sql)

    def test_import_product_aliases_dry_run_validates_product_ids(self):
        temp_dir = Path("tests/.tmp/product_alias_import_case")
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        csv_path = temp_dir / "aliases.csv"
        with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=["alias_name", "product_id", "source_system", "is_active"],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "alias_name": "爪切りのみ",
                    "product_id": "12",
                    "source_system": "pos",
                    "is_active": "true",
                }
            )

        calls: list[str] = []

        def fake_runner(sql: str):
            calls.append(sql)
            return [{"id": 12}]

        result = import_product_aliases(csv_path=csv_path, query_runner=fake_runner, apply=False)

        self.assertTrue(result.dry_run)
        self.assertEqual(result.actionable_rows, 1)
        self.assertEqual(result.skipped_rows, 0)
        self.assertEqual(result.upserted_rows, 0)
        self.assertEqual(len(calls), 1)

        shutil.rmtree(temp_dir)

    def test_import_product_aliases_apply_returns_upserted_count(self):
        temp_dir = Path("tests/.tmp/product_alias_import_apply_case")
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        csv_path = temp_dir / "aliases.csv"
        with csv_path.open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=["alias_name", "product_id", "source_system", "is_active"],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "alias_name": "足裏バリカン",
                    "product_id": "25",
                    "source_system": "pos",
                    "is_active": "true",
                }
            )

        def fake_runner(sql: str):
            if "FROM public.products" in sql:
                return [{"id": 25}]
            return [{"upserted_count": 1}]

        result = import_product_aliases(csv_path=csv_path, query_runner=fake_runner, apply=True)

        self.assertFalse(result.dry_run)
        self.assertEqual(result.upserted_rows, 1)
        self.assertEqual(result.actionable_rows, 1)

        shutil.rmtree(temp_dir)


if __name__ == "__main__":
    unittest.main()
