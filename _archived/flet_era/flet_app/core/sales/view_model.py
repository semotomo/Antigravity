from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Iterable


UNCLASSIFIED_CATEGORY = "未分類"
UNKNOWN_JAN_CODE = "-"


def _clean_text(value: object, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _to_int(value: object, default: int = 0) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return default


def _parse_date(value: object) -> date | None:
    if isinstance(value, date):
        return value

    text = _clean_text(value)
    if not text:
        return None

    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).date()
    except ValueError:
        try:
            return datetime.strptime(text[:10], "%Y-%m-%d").date()
        except ValueError:
            return None


def enrich_sales_records(
    sales_records: Iterable[dict],
    master_records: Iterable[dict],
) -> list[dict]:
    master_by_name: dict[str, dict] = {}
    for record in master_records:
        product_name = _clean_text(record.get("product_name"))
        if product_name:
            master_by_name[product_name] = record

    enriched_rows: list[dict] = []
    for record in sales_records:
        product_name = _clean_text(record.get("product_name"), "商品名未設定")
        store_name = _clean_text(record.get("store_name"), "店舗未設定")
        quantity = max(_to_int(record.get("quantity"), 0), 0)
        total_amount = max(_to_int(record.get("total_amount"), 0), 0)
        transaction_date = _clean_text(record.get("transaction_date"))
        transaction_date_value = _parse_date(transaction_date)

        master = master_by_name.get(product_name)
        jan_code = UNKNOWN_JAN_CODE
        category = UNCLASSIFIED_CATEGORY
        cost_price = 0
        unmatched_master = True

        if master:
            jan_code = _clean_text(master.get("jan_code"), UNKNOWN_JAN_CODE)
            category = _clean_text(master.get("category"), UNCLASSIFIED_CATEGORY)
            cost_price = max(_to_int(master.get("cost_price"), 0), 0)
            unmatched_master = False

        estimated_cost = cost_price * quantity if master else total_amount

        enriched_rows.append(
            {
                "transaction_date": transaction_date,
                "transaction_date_value": transaction_date_value,
                "store_name": store_name,
                "product_name": product_name,
                "quantity": quantity,
                "total_amount": total_amount,
                "jan_code": jan_code,
                "category": category,
                "cost_price": cost_price,
                "estimated_cost": estimated_cost,
                "estimated_profit": total_amount - estimated_cost,
                "unmatched_master": unmatched_master,
            }
        )

    return enriched_rows


def filter_sales_records(
    rows: Iterable[dict],
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    search_query: str = "",
    store_name: str = "",
) -> list[dict]:
    search = _clean_text(search_query).lower()
    normalized_store = _clean_text(store_name)
    filtered_rows: list[dict] = []

    for row in rows:
        row_date = row.get("transaction_date_value")
        if date_from and row_date and row_date < date_from:
            continue
        if date_from and row_date is None:
            continue
        if date_to and row_date and row_date > date_to:
            continue
        if date_to and row_date is None:
            continue
        if normalized_store and normalized_store != "すべて" and row.get("store_name") != normalized_store:
            continue

        if search:
            haystacks = [
                _clean_text(row.get("product_name")).lower(),
                _clean_text(row.get("jan_code")).lower(),
                _clean_text(row.get("category")).lower(),
                _clean_text(row.get("store_name")).lower(),
            ]
            if not any(search in haystack for haystack in haystacks):
                continue

        filtered_rows.append(dict(row))

    return sorted(
        filtered_rows,
        key=lambda row: (
            row.get("transaction_date_value") or date.min,
            _to_int(row.get("total_amount")),
            _clean_text(row.get("product_name")),
        ),
        reverse=True,
    )


def build_sales_summary(rows: Iterable[dict]) -> dict:
    row_list = list(rows)
    total_amount = sum(_to_int(row.get("total_amount")) for row in row_list)
    total_quantity = sum(_to_int(row.get("quantity")) for row in row_list)
    estimated_cost = sum(_to_int(row.get("estimated_cost")) for row in row_list)
    product_names = {
        _clean_text(row.get("product_name"))
        for row in row_list
        if _clean_text(row.get("product_name"))
    }
    store_names = {
        _clean_text(row.get("store_name"))
        for row in row_list
        if _clean_text(row.get("store_name"))
    }

    return {
        "total_amount": total_amount,
        "total_quantity": total_quantity,
        "product_count": len(product_names),
        "store_count": len(store_names),
        "estimated_cost": estimated_cost,
        "estimated_profit": total_amount - estimated_cost,
        "average_unit_price": round(total_amount / total_quantity, 2) if total_quantity else 0,
    }


def _group_totals(rows: Iterable[dict], key_name: str) -> list[dict]:
    grouped: dict[str, dict] = defaultdict(
        lambda: {
            key_name: "",
            "total_amount": 0,
            "total_quantity": 0,
            "estimated_profit": 0,
            "estimated_cost": 0,
            "line_count": 0,
        }
    )

    for row in rows:
        key = _clean_text(row.get(key_name), UNCLASSIFIED_CATEGORY if key_name == "category" else "-")
        bucket = grouped[key]
        bucket[key_name] = key
        bucket["total_amount"] += _to_int(row.get("total_amount"))
        bucket["total_quantity"] += _to_int(row.get("quantity"))
        bucket["estimated_profit"] += _to_int(row.get("estimated_profit"))
        bucket["estimated_cost"] += _to_int(row.get("estimated_cost"))
        bucket["line_count"] += 1

    return sorted(
        grouped.values(),
        key=lambda row: (row["total_amount"], row["total_quantity"], row[key_name]),
        reverse=True,
    )


def build_product_breakdown(rows: Iterable[dict], limit: int | None = None) -> list[dict]:
    grouped: dict[str, dict] = defaultdict(
        lambda: {
            "product_name": "",
            "jan_code": UNKNOWN_JAN_CODE,
            "category": UNCLASSIFIED_CATEGORY,
            "total_amount": 0,
            "total_quantity": 0,
            "estimated_profit": 0,
            "estimated_cost": 0,
            "unmatched_master": False,
        }
    )

    for row in rows:
        product_name = _clean_text(row.get("product_name"), "商品名未設定")
        bucket = grouped[product_name]
        bucket["product_name"] = product_name
        bucket["jan_code"] = _clean_text(row.get("jan_code"), UNKNOWN_JAN_CODE)
        bucket["category"] = _clean_text(row.get("category"), UNCLASSIFIED_CATEGORY)
        bucket["total_amount"] += _to_int(row.get("total_amount"))
        bucket["total_quantity"] += _to_int(row.get("quantity"))
        bucket["estimated_profit"] += _to_int(row.get("estimated_profit"))
        bucket["estimated_cost"] += _to_int(row.get("estimated_cost"))
        bucket["unmatched_master"] = bucket["unmatched_master"] or bool(row.get("unmatched_master"))

    result = sorted(
        grouped.values(),
        key=lambda row: (row["total_amount"], row["total_quantity"], row["product_name"]),
        reverse=True,
    )
    if limit is not None:
        return result[:limit]
    return result


def build_abc_analysis(rows: Iterable[dict]) -> list[dict]:
    product_rows = build_product_breakdown(rows)
    total_amount = sum(row["total_amount"] for row in product_rows) or 1
    running_total = 0

    analysis_rows: list[dict] = []
    for row in product_rows:
        running_total += row["total_amount"]
        cumulative_ratio = running_total / total_amount
        if cumulative_ratio <= 0.7:
            band = "A"
        elif cumulative_ratio <= 0.97:
            band = "B"
        else:
            band = "C"

        analysis_rows.append(
            {
                **row,
                "share_ratio": row["total_amount"] / total_amount,
                "cumulative_ratio": cumulative_ratio,
                "abc_band": band,
            }
        )

    return analysis_rows


def build_category_breakdown(rows: Iterable[dict]) -> list[dict]:
    return _group_totals(rows, "category")


def build_store_breakdown(rows: Iterable[dict]) -> list[dict]:
    return _group_totals(rows, "store_name")


def build_daily_breakdown(rows: Iterable[dict]) -> list[dict]:
    grouped: dict[str, dict] = defaultdict(
        lambda: {
            "transaction_date": "",
            "transaction_date_value": None,
            "total_amount": 0,
            "total_quantity": 0,
        }
    )

    for row in rows:
        row_date = row.get("transaction_date_value")
        if row_date is None:
            continue
        key = row_date.isoformat()
        bucket = grouped[key]
        bucket["transaction_date"] = key
        bucket["transaction_date_value"] = row_date
        bucket["total_amount"] += _to_int(row.get("total_amount"))
        bucket["total_quantity"] += _to_int(row.get("quantity"))

    return sorted(grouped.values(), key=lambda row: row["transaction_date_value"])


def build_unmatched_breakdown(rows: Iterable[dict]) -> list[dict]:
    return [row for row in build_product_breakdown(rows) if row.get("unmatched_master")]
