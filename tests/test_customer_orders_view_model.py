import unittest
from types import SimpleNamespace

import flet as ft

from flet_app.pages.customer_orders import CustomerOrdersPageController
from flet_app.core.customer_orders.view_model import (
    STATUS_LABELS,
    build_status_counts,
    format_order_timestamp,
    get_next_status_action,
    normalize_order_payload,
    normalize_order_record,
)


class CustomerOrdersViewModelTests(unittest.TestCase):
    def test_normalize_order_payload_trims_required_fields_and_defaults_status(self):
        payload = normalize_order_payload(
            {
                "customer_name": "  山田 花子  ",
                "phone_number": " 090-1234-5678 ",
                "item_name": "  洗剤 2個  ",
                "item_details": "  メーカーA  ",
                "staff_name": "  佐藤 ",
                "notes": "  午後連絡希望 ",
                "status": "",
            }
        )

        self.assertEqual(payload["customer_name"], "山田 花子")
        self.assertEqual(payload["phone_number"], "090-1234-5678")
        self.assertEqual(payload["item_name"], "洗剤 2個")
        self.assertEqual(payload["item_details"], "メーカーA")
        self.assertEqual(payload["staff_name"], "佐藤")
        self.assertEqual(payload["notes"], "午後連絡希望")
        self.assertEqual(payload["status"], "pending")

    def test_normalize_order_payload_rejects_missing_required_fields(self):
        with self.assertRaises(ValueError):
            normalize_order_payload(
                {
                    "customer_name": "山田",
                    "phone_number": "",
                    "item_name": "洗剤",
                }
            )

    def test_get_next_status_action_returns_expected_labels(self):
        self.assertEqual(get_next_status_action("pending"), ("ordered", "発注済にする"))
        self.assertEqual(get_next_status_action("ordered"), ("arrived", "入荷済にする"))
        self.assertEqual(get_next_status_action("arrived"), ("contacted", "連絡済にする"))
        self.assertEqual(get_next_status_action("contacted"), ("completed", "お渡し完了にする"))
        self.assertEqual(get_next_status_action("completed"), (None, ""))
        self.assertEqual(get_next_status_action("cancelled"), (None, ""))

    def test_build_status_counts_initializes_all_known_statuses(self):
        counts = build_status_counts(
            [
                {"status": "pending"},
                {"status": "pending"},
                {"status": "ordered"},
                {"status": "completed"},
            ]
        )

        self.assertEqual(counts["pending"], 2)
        self.assertEqual(counts["ordered"], 1)
        self.assertEqual(counts["arrived"], 0)
        self.assertEqual(counts["contacted"], 0)
        self.assertEqual(counts["completed"], 1)
        self.assertEqual(counts["cancelled"], 0)

    def test_normalize_order_record_adds_display_labels(self):
        record = normalize_order_record(
            {
                "id": "abc-123",
                "customer_name": "山田 花子",
                "phone_number": "09012345678",
                "item_name": "洗剤 2個",
                "item_details": "メーカーA / 品番123",
                "staff_name": "佐藤",
                "notes": "夕方に連絡",
                "status": "ordered",
                "created_at": "2026-03-24T09:15:00+09:00",
                "updated_at": "2026-03-24T10:00:00+09:00",
            }
        )

        self.assertEqual(record["id"], "abc-123")
        self.assertEqual(record["status"], "ordered")
        self.assertEqual(record["status_label"], STATUS_LABELS["ordered"])
        self.assertEqual(record["created_label"], "2026/03/24 09:15")
        self.assertEqual(record["updated_label"], "2026/03/24 10:00")
        self.assertEqual(record["customer_name"], "山田 花子")

    def test_format_order_timestamp_returns_fallback_for_invalid_values(self):
        self.assertEqual(format_order_timestamp(None), "-")
        self.assertEqual(format_order_timestamp(""), "-")
        self.assertEqual(format_order_timestamp("not-a-date"), "-")


class CustomerOrdersPageTests(unittest.TestCase):
    def test_build_status_body_returns_cards_for_active_orders(self):
        controller = CustomerOrdersPageController(SimpleNamespace())
        controller.state.loading = False
        controller.state.orders = [
            {
                "id": "order-1",
                "customer_name": "山田 太郎",
                "phone_number": "09012345678",
                "item_name": "電池 2個",
                "item_details": "",
                "staff_name": "佐藤",
                "notes": "",
                "status": "pending",
                "created_at": "2026-03-24T09:15:00+09:00",
                "updated_at": "2026-03-24T10:00:00+09:00",
            }
        ]

        body = controller._build_status_body("pending")

        self.assertIsInstance(body, ft.Column)
        self.assertEqual(len(body.controls), 1)
        self.assertIsInstance(body.controls[0], ft.Container)


if __name__ == "__main__":
    unittest.main()
