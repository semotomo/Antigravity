import unittest
from datetime import date

from flet_app.core.sales.view_model import (
    build_abc_analysis,
    build_category_breakdown,
    build_sales_summary,
    enrich_sales_records,
    filter_sales_records,
)


class SalesViewModelTests(unittest.TestCase):
    def setUp(self):
        self.sales_records = [
            {
                "transaction_date": "2026-03-01",
                "store_name": "本店",
                "product_name": "犬ガム",
                "quantity": 10,
                "total_amount": 10000,
            },
            {
                "transaction_date": "2026-03-02",
                "store_name": "本店",
                "product_name": "犬ガム",
                "quantity": 5,
                "total_amount": 5000,
            },
            {
                "transaction_date": "2026-03-02",
                "store_name": "わんわん",
                "product_name": "猫缶",
                "quantity": 8,
                "total_amount": 8000,
            },
            {
                "transaction_date": "2026-03-03",
                "store_name": "本店",
                "product_name": "鳥おやつ",
                "quantity": 2,
                "total_amount": 1000,
            },
        ]
        self.master_records = [
            {
                "product_name": "犬ガム",
                "jan_code": "111",
                "category": "犬おやつ",
                "cost_price": 400,
            },
            {
                "product_name": "猫缶",
                "jan_code": "222",
                "category": "猫フード",
                "cost_price": 500,
            },
        ]

    def test_enrich_sales_records_maps_master_fields_and_unmatched_flag(self):
        rows = enrich_sales_records(self.sales_records, self.master_records)

        dog = next(row for row in rows if row["product_name"] == "犬ガム")
        bird = next(row for row in rows if row["product_name"] == "鳥おやつ")

        self.assertEqual(dog["jan_code"], "111")
        self.assertEqual(dog["category"], "犬おやつ")
        self.assertEqual(dog["estimated_cost"], 4000)
        self.assertFalse(dog["unmatched_master"])
        self.assertEqual(bird["jan_code"], "-")
        self.assertEqual(bird["category"], "未分類")
        self.assertTrue(bird["unmatched_master"])

    def test_filter_sales_records_supports_date_query_and_store(self):
        rows = enrich_sales_records(self.sales_records, self.master_records)

        filtered = filter_sales_records(
            rows,
            date_from=date(2026, 3, 2),
            date_to=date(2026, 3, 2),
            search_query="猫",
            store_name="わんわん",
        )

        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["product_name"], "猫缶")

    def test_build_sales_summary_calculates_totals_products_stores_and_profit(self):
        rows = enrich_sales_records(self.sales_records, self.master_records)

        summary = build_sales_summary(rows)

        self.assertEqual(summary["total_amount"], 24000)
        self.assertEqual(summary["total_quantity"], 25)
        self.assertEqual(summary["product_count"], 3)
        self.assertEqual(summary["store_count"], 2)
        self.assertEqual(summary["estimated_cost"], 11000)
        self.assertEqual(summary["estimated_profit"], 13000)

    def test_build_abc_analysis_aggregates_by_product_and_assigns_bands(self):
        rows = enrich_sales_records(self.sales_records, self.master_records)

        abc_rows = build_abc_analysis(rows)

        self.assertEqual(abc_rows[0]["product_name"], "犬ガム")
        self.assertEqual(abc_rows[0]["abc_band"], "A")
        self.assertEqual(abc_rows[1]["product_name"], "猫缶")
        self.assertEqual(abc_rows[1]["abc_band"], "B")
        self.assertEqual(abc_rows[2]["product_name"], "鳥おやつ")
        self.assertEqual(abc_rows[2]["abc_band"], "C")

    def test_build_category_breakdown_groups_unclassified_products(self):
        rows = enrich_sales_records(self.sales_records, self.master_records)

        category_rows = build_category_breakdown(rows)

        self.assertEqual(category_rows[0]["category"], "犬おやつ")
        self.assertEqual(category_rows[0]["total_amount"], 15000)
        self.assertEqual(category_rows[1]["category"], "猫フード")
        self.assertEqual(category_rows[1]["total_amount"], 8000)
        self.assertEqual(category_rows[2]["category"], "未分類")
        self.assertEqual(category_rows[2]["total_amount"], 1000)


if __name__ == "__main__":
    unittest.main()
