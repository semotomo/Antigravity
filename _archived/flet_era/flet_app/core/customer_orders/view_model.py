from __future__ import annotations

from datetime import datetime
from typing import Any


# 客注の進行順。タブは業務中に触る4状態のみを表示する。
STATUS_FLOW = ["pending", "ordered", "arrived", "contacted", "completed"]
ACTIVE_TAB_STATUSES = ["pending", "ordered", "arrived", "contacted"]
TERMINAL_STATUSES = ["completed", "cancelled"]
KNOWN_STATUSES = ACTIVE_TAB_STATUSES + TERMINAL_STATUSES

STATUS_LABELS = {
    "pending": "未発注",
    "ordered": "入荷待ち",
    "arrived": "連絡待ち",
    "contacted": "お渡し待ち",
    "completed": "完了",
    "cancelled": "キャンセル",
}

NEXT_STATUS_ACTIONS = {
    "pending": ("ordered", "発注済にする"),
    "ordered": ("arrived", "入荷済にする"),
    "arrived": ("contacted", "連絡済にする"),
    "contacted": ("completed", "お渡し完了にする"),
}


def _text(value: Any) -> str:
    """None や空白を吸収して扱いやすい文字列へ寄せる。"""
    return str(value or "").strip()


def format_order_timestamp(value: Any) -> str:
    """ISO形式の日時を画面表示向けに整形する。"""
    text = _text(value)
    if not text:
        return "-"

    try:
        normalized = text.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).strftime("%Y/%m/%d %H:%M")
    except ValueError:
        return "-"


def normalize_order_payload(payload: dict[str, Any]) -> dict[str, str]:
    """フォーム入力を Supabase 登録向けに正規化する。"""
    normalized = {
        "customer_name": _text(payload.get("customer_name")),
        "phone_number": _text(payload.get("phone_number")),
        "item_name": _text(payload.get("item_name")),
        "item_details": _text(payload.get("item_details")),
        "staff_name": _text(payload.get("staff_name")),
        "notes": _text(payload.get("notes")),
        "status": _text(payload.get("status")) or "pending",
    }

    if not normalized["customer_name"]:
        raise ValueError("お客様名は必須です。")
    if not normalized["phone_number"]:
        raise ValueError("電話番号は必須です。")
    if not normalized["item_name"]:
        raise ValueError("商品名/数量は必須です。")
    if normalized["status"] not in STATUS_LABELS:
        raise ValueError("不正なステータスです。")

    return normalized


def normalize_order_record(record: dict[str, Any]) -> dict[str, Any]:
    """DBレコードを画面描画しやすい形へそろえる。"""
    status = _text(record.get("status")) or "pending"
    created_at = _text(record.get("created_at"))
    updated_at = _text(record.get("updated_at")) or created_at

    return {
        "id": _text(record.get("id")),
        "customer_name": _text(record.get("customer_name")),
        "phone_number": _text(record.get("phone_number")),
        "item_name": _text(record.get("item_name")),
        "item_details": _text(record.get("item_details")),
        "staff_name": _text(record.get("staff_name")),
        "notes": _text(record.get("notes")),
        "status": status if status in STATUS_LABELS else "pending",
        "status_label": STATUS_LABELS.get(status, STATUS_LABELS["pending"]),
        "created_at": created_at,
        "updated_at": updated_at,
        "created_label": format_order_timestamp(created_at),
        "updated_label": format_order_timestamp(updated_at),
    }


def sort_orders_for_display(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """更新日時の新しい順で並べる。"""
    normalized = [normalize_order_record(record) for record in records]
    return sorted(
        normalized,
        key=lambda record: (record.get("updated_at", ""), record.get("created_at", "")),
        reverse=True,
    )


def orders_for_status(records: list[dict[str, Any]], status: str) -> list[dict[str, Any]]:
    """指定ステータスだけを抽出して一覧表示順に並べる。"""
    return [record for record in sort_orders_for_display(records) if record["status"] == status]


def build_status_counts(records: list[dict[str, Any]]) -> dict[str, int]:
    """ステータス別件数をゼロ埋め付きで返す。"""
    counts = {status: 0 for status in KNOWN_STATUSES}
    for record in records:
        status = _text(record.get("status"))
        if status in counts:
            counts[status] += 1
    return counts


def get_next_status_action(status: str) -> tuple[str | None, str]:
    """次へ進めるステータスとボタン文言を返す。"""
    return NEXT_STATUS_ACTIONS.get(_text(status), (None, ""))
