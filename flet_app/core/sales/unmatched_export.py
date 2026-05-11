from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


SUMMARY_FIELDS = [
    "alias_name",
    "sale_rows",
    "total_quantity",
    "total_sales_amount",
    "first_sale_date",
    "last_sale_date",
    "distinct_store_count",
]

TEMPLATE_FIELDS = [
    "alias_name",
    "product_id",
    "source_system",
    "is_active",
    "candidate_sale_rows",
    "candidate_total_quantity",
    "candidate_total_sales_amount",
    "first_sale_date",
    "last_sale_date",
    "distinct_store_count",
]

PRODUCT_SEED_FIELDS = [
    "product_name",
    "jan_code",
    "category",
    "product_group",
    "brand",
    "cost_price",
    "selling_price",
    "is_active",
    "candidate_sale_rows",
    "candidate_total_quantity",
    "candidate_total_sales_amount",
    "first_sale_date",
    "last_sale_date",
    "distinct_store_count",
]

DEFAULT_OUTPUT_DIR = Path("local_exports") / "budibase"
QueryRunner = Callable[[str], list[dict[str, Any]]]


@dataclass(frozen=True)
class ExportArtifacts:
    summary_csv: Path
    alias_template_csv: Path
    product_seed_csv: Path
    summary_json: Path
    row_count: int


def infer_service_product_group(alias_name: Any) -> str:
    normalized = str(alias_name or "").strip()
    if any(pattern in normalized for pattern in ("一時預かり", "預かり")):
        return "ホテル"
    if "送迎" in normalized:
        return "送迎"
    if any(
        pattern in normalized
        for pattern in (
            "爪切り",
            "肛門腺",
            "耳掃除",
            "ハミガキ",
            "歯みがき",
            "足裏バリカン",
            "部分カット",
            "飾り毛カット",
        )
    ):
        return "オプション"
    return "トリミング"


def estimate_service_selling_price(row: Mapping[str, Any]) -> int:
    quantity_raw = row.get("total_quantity", 0)
    sale_rows_raw = row.get("sale_rows", 0)
    total_sales_raw = row.get("total_sales_amount", 0)

    try:
        quantity = int(quantity_raw or 0)
    except (TypeError, ValueError):
        quantity = 0
    try:
        sale_rows = int(sale_rows_raw or 0)
    except (TypeError, ValueError):
        sale_rows = 0
    try:
        total_sales = Decimal(str(total_sales_raw or 0))
    except (InvalidOperation, ValueError):
        total_sales = Decimal("0")

    denominator = quantity if quantity > 0 else sale_rows if sale_rows > 0 else 1
    unit_price = (total_sales / Decimal(denominator)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(unit_price)


def build_unmatched_summary_sql(limit: int | None = None) -> str:
    sql = """
SELECT
    product_name AS alias_name,
    COUNT(*)::INTEGER AS sale_rows,
    COALESCE(SUM(quantity), 0)::INTEGER AS total_quantity,
    COALESCE(SUM(sales_amount), 0)::NUMERIC(12, 2) AS total_sales_amount,
    MIN(sale_date) AS first_sale_date,
    MAX(sale_date) AS last_sale_date,
    COUNT(DISTINCT store_name)::INTEGER AS distinct_store_count
FROM public.sales_enriched_v
WHERE unmatched_master = TRUE
GROUP BY product_name
ORDER BY sale_rows DESC, total_sales_amount DESC, alias_name
""".strip()
    sql = " ".join(sql.split())
    if limit is not None:
        sql = f"{sql}\nLIMIT {int(limit)}"
    return sql


def build_alias_import_rows(summary_rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    alias_rows: list[dict[str, Any]] = []
    for row in summary_rows:
        alias_rows.append(
            {
                "alias_name": row.get("alias_name", ""),
                "product_id": "",
                "source_system": "pos",
                "is_active": True,
                "candidate_sale_rows": row.get("sale_rows", 0),
                "candidate_total_quantity": row.get("total_quantity", 0),
                "candidate_total_sales_amount": row.get("total_sales_amount", "0.00"),
                "first_sale_date": row.get("first_sale_date", ""),
                "last_sale_date": row.get("last_sale_date", ""),
                "distinct_store_count": row.get("distinct_store_count", 0),
            }
        )
    return alias_rows


def build_product_seed_rows(summary_rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    product_rows: list[dict[str, Any]] = []
    for row in summary_rows:
        alias_name = row.get("alias_name", "")
        product_rows.append(
            {
                "product_name": alias_name,
                "jan_code": "",
                "category": "サービス",
                "product_group": infer_service_product_group(alias_name),
                "brand": "",
                "cost_price": 0,
                "selling_price": estimate_service_selling_price(row),
                "is_active": True,
                "candidate_sale_rows": row.get("sale_rows", 0),
                "candidate_total_quantity": row.get("total_quantity", 0),
                "candidate_total_sales_amount": row.get("total_sales_amount", "0.00"),
                "first_sale_date": row.get("first_sale_date", ""),
                "last_sale_date": row.get("last_sale_date", ""),
                "distinct_store_count": row.get("distinct_store_count", 0),
            }
        )
    return product_rows


def extract_json_payload(output_text: str) -> Any:
    decoder = json.JSONDecoder()
    for index, char in enumerate(output_text):
        if char not in "[{":
            continue
        try:
            payload, _ = decoder.raw_decode(output_text[index:])
        except json.JSONDecodeError:
            continue
        return payload
    raise ValueError("Supabase CLI output did not contain a JSON payload.")


def write_csv_rows(path: Path, rows: Sequence[Mapping[str, Any]], fieldnames: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def export_unmatched_sales_reports(
    *,
    query_runner: QueryRunner,
    output_dir: Path | str = DEFAULT_OUTPUT_DIR,
    limit: int | None = None,
) -> ExportArtifacts:
    output_path = Path(output_dir)
    summary_rows = query_runner(build_unmatched_summary_sql(limit=limit))
    alias_rows = build_alias_import_rows(summary_rows)
    product_rows = build_product_seed_rows(summary_rows)

    summary_csv = output_path / "unmatched_sales_candidates.csv"
    alias_template_csv = output_path / "product_aliases_import_template.csv"
    product_seed_csv = output_path / "products_seed_template.csv"
    summary_json = output_path / "unmatched_sales_candidates.json"

    write_csv_rows(summary_csv, summary_rows, SUMMARY_FIELDS)
    write_csv_rows(alias_template_csv, alias_rows, TEMPLATE_FIELDS)
    write_csv_rows(product_seed_csv, product_rows, PRODUCT_SEED_FIELDS)

    summary_json.parent.mkdir(parents=True, exist_ok=True)
    summary_json.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "limit": limit,
                "row_count": len(summary_rows),
                "rows": summary_rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return ExportArtifacts(
        summary_csv=summary_csv,
        alias_template_csv=alias_template_csv,
        product_seed_csv=product_seed_csv,
        summary_json=summary_json,
        row_count=len(summary_rows),
    )
