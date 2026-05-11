import unittest

from flet_app.core.inventory.view_model import (
    available_destination_stores,
    build_web_asset_url,
    choose_default_from_store_id,
    format_transfer_history,
    make_transfer_item,
    normalize_store_records,
    summarize_transfer_items,
)


class InventoryViewModelTests(unittest.TestCase):
    def test_normalize_store_records_coerces_ids_and_filters_missing_names(self):
        stores = normalize_store_records(
            [
                {"id": 1, "name": "店舗A"},
                {"id": "2", "name": "店舗B"},
                {"id": 3, "name": ""},
                {"id": None, "name": "店舗C"},
            ]
        )

        self.assertEqual(
            stores,
            [
                {"id": "1", "name": "店舗A"},
                {"id": "2", "name": "店舗B"},
            ],
        )

    def test_available_destination_stores_excludes_current_store(self):
        stores = [
            {"id": "1", "name": "店舗A"},
            {"id": "2", "name": "店舗B"},
            {"id": "3", "name": "店舗C"},
        ]

        self.assertEqual(
            available_destination_stores(stores, "2"),
            [
                {"id": "1", "name": "店舗A"},
                {"id": "3", "name": "店舗C"},
            ],
        )

    def test_choose_default_from_store_id_prefers_honten(self):
        stores = [
            {"id": "2", "name": "佐世保"},
            {"id": "1", "name": "本店"},
            {"id": "3", "name": "マックス"},
        ]

        self.assertEqual(choose_default_from_store_id(stores), "1")

    def test_make_transfer_item_builds_expected_payload(self):
        item = make_transfer_item(
            product={
                "jan_code": "4900000000012",
                "product_name": "テスト商品",
                "cost_price": 120,
                "selling_price": 180,
            },
            quantity=3,
            from_store_id="1",
            to_store_id="2",
            memo="急ぎ",
        )

        self.assertEqual(item["jan_code"], "4900000000012")
        self.assertEqual(item["product_name"], "テスト商品")
        self.assertEqual(item["quantity"], 3)
        self.assertEqual(item["cost_price"], 120)
        self.assertEqual(item["selling_price"], 180)
        self.assertEqual(item["from_store_id"], "1")
        self.assertEqual(item["to_store_id"], "2")
        self.assertEqual(item["memo"], "急ぎ")

    def test_make_transfer_item_rejects_same_store(self):
        with self.assertRaises(ValueError):
            make_transfer_item(
                product={"jan_code": "4900", "product_name": "同一店舗", "cost_price": 100},
                quantity=1,
                from_store_id="1",
                to_store_id="1",
            )

    def test_summarize_transfer_items_counts_products_quantities_and_cost(self):
        summary = summarize_transfer_items(
            [
                {"quantity": 2, "cost_price": 120},
                {"quantity": 5, "cost_price": 80},
            ]
        )

        self.assertEqual(
            summary,
            {
                "product_count": 2,
                "total_quantity": 7,
                "total_cost": 640,
            },
        )

    def test_format_transfer_history_flattens_store_names_and_date(self):
        rows = format_transfer_history(
            [
                {
                    "transfer_date": "2026-03-23T10:30:00+00:00",
                    "from_store": {"name": "店舗A"},
                    "to_store": {"name": "店舗B"},
                    "product_name": "水",
                    "jan_code": "4900",
                    "quantity": 2,
                    "cost_price": 100,
                    "total_cost": 200,
                    "selling_price": 150,
                }
            ]
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["日付"], "2026/03/23 10:30")
        self.assertEqual(rows[0]["移動元"], "店舗A")
        self.assertEqual(rows[0]["移動先"], "店舗B")
        self.assertEqual(rows[0]["商品名"], "水")
        self.assertEqual(rows[0]["原価合計"], 200)


    def test_build_web_asset_url_converts_websocket_scheme_for_render(self):
        url = build_web_asset_url(
            "wss://antigravity-flet.onrender.com/ws",
            "/inventory",
            "/assets/jan_scanner.html",
        )

        self.assertEqual(url, "https://antigravity-flet.onrender.com/assets/jan_scanner.html")

    def test_build_web_asset_url_removes_current_route_suffix(self):
        url = build_web_asset_url(
            "https://antigravity-flet.onrender.com/inventory",
            "/inventory",
            "/assets/jan_scanner.html",
        )

        self.assertEqual(url, "https://antigravity-flet.onrender.com/assets/jan_scanner.html")


if __name__ == "__main__":
    unittest.main()
