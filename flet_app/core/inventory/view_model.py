from __future__ import annotations

from datetime import datetime
from typing import Any


def _as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def normalize_store_records(stores: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for store in stores or []:
        store_id = store.get("id")
        store_name = str(store.get("name", "")).strip()
        if store_id in (None, "") or not store_name:
            continue
        normalized.append({"id": str(store_id), "name": store_name})
    return normalized


def available_destination_stores(stores: list[dict], from_store_id: str | None) -> list[dict]:
    return [store for store in stores if store.get("id") != from_store_id]


def choose_default_from_store_id(
    stores: list[dict], preferred_names: tuple[str, ...] = ("本店",)
) -> str | None:
    if not stores:
        return None

    for preferred_name in preferred_names:
        for store in stores:
            if str(store.get("name", "")).strip() == preferred_name:
                return str(store.get("id"))

    return str(stores[0].get("id"))


def make_transfer_item(
    product: dict,
    quantity: int,
    from_store_id: str | None,
    to_store_id: str | None,
    memo: str = "",
) -> dict:
    if not from_store_id or not to_store_id:
        raise ValueError("移動元と移動先の店舗を選択してください")
    if from_store_id == to_store_id:
        raise ValueError("移動元と移動先に同じ店舗は選べません")

    jan_code = str(product.get("jan_code", "")).strip()
    product_name = str(product.get("product_name", "")).strip()
    if not jan_code or not product_name:
        raise ValueError("商品情報が不足しています")

    normalized_quantity = _as_int(quantity)
    if normalized_quantity <= 0:
        raise ValueError("数量は1以上で入力してください")

    return {
        "jan_code": jan_code,
        "product_name": product_name,
        "quantity": normalized_quantity,
        "cost_price": _as_int(product.get("cost_price")),
        "selling_price": _as_int(product.get("selling_price")),
        "from_store_id": str(from_store_id),
        "to_store_id": str(to_store_id),
        "memo": memo.strip(),
    }


def prepare_transfer_payload(items: list[dict]) -> list[dict]:
    payload: list[dict] = []
    for item in items:
        payload.append(
            {
                **item,
                "quantity": _as_int(item.get("quantity"), 1),
                "cost_price": _as_int(item.get("cost_price")),
                "selling_price": _as_int(item.get("selling_price")),
                "from_store_id": _as_int(item.get("from_store_id")),
                "to_store_id": _as_int(item.get("to_store_id")),
            }
        )
    return payload


def summarize_transfer_items(items: list[dict]) -> dict:
    return {
        "product_count": len(items),
        "total_quantity": sum(_as_int(item.get("quantity")) for item in items),
        "total_cost": sum(
            _as_int(item.get("quantity")) * _as_int(item.get("cost_price")) for item in items
        ),
    }


def format_transfer_history(transfers: list[dict] | None) -> list[dict]:
    rows: list[dict] = []
    for transfer in transfers or []:
        transfer_date = str(transfer.get("transfer_date", "")).strip()
        if transfer_date:
            try:
                parsed = datetime.fromisoformat(transfer_date.replace("Z", "+00:00"))
                transfer_date = parsed.strftime("%Y/%m/%d %H:%M")
            except ValueError:
                pass

        from_store = transfer.get("from_store")
        to_store = transfer.get("to_store")

        rows.append(
            {
                "日付": transfer_date,
                "移動元": from_store.get("name", "-") if isinstance(from_store, dict) else "-",
                "移動先": to_store.get("name", "-") if isinstance(to_store, dict) else "-",
                "商品名": transfer.get("product_name", ""),
                "JAN": transfer.get("jan_code", ""),
                "数量": _as_int(transfer.get("quantity")),
                "原価": _as_int(transfer.get("cost_price")),
                "原価合計": _as_int(transfer.get("total_cost")),
                "売価": _as_int(transfer.get("selling_price")),
                "_id": transfer.get("id"),
            }
        )
    return rows


def format_product_rows(products: list[dict] | None) -> list[dict]:
    rows: list[dict] = []
    for product in products or []:
        rows.append(
            {
                "JANコード": str(product.get("jan_code", "")).strip(),
                "商品名": str(product.get("product_name", "")).strip(),
                "原価": _as_int(product.get("cost_price")),
                "売価": _as_int(product.get("selling_price")),
                "区分": str(product.get("category", "")).strip(),
            }
        )
    return rows
