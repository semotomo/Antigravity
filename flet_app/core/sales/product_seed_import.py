from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from flet_app.core.sales.unmatched_export import DEFAULT_OUTPUT_DIR


AUTO_JAN_PREFIX = "svc:auto:"
DEFAULT_PRODUCT_IMPORT_CSV = DEFAULT_OUTPUT_DIR / "products_seed_template.csv"
QueryRunner = Callable[[str], list[dict[str, Any]]]


@dataclass(frozen=True)
class PreparedProductSeedRows:
    actionable_rows: list[dict[str, Any]]
    skipped_rows: int
    errors: list[str]


@dataclass(frozen=True)
class ProductSeedImportResult:
    csv_path: Path
    dry_run: bool
    total_rows: int
    actionable_rows: int
    skipped_rows: int
    upserted_rows: int
    errors: list[str]


def _parse_bool(value: Any, *, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default

    normalized = str(value).strip().lower()
    if not normalized:
        return default
    if normalized in {"true", "1", "yes", "y", "on"}:
        return True
    if normalized in {"false", "0", "no", "n", "off"}:
        return False
    raise ValueError(f"Invalid boolean value: {value!r}")


def _build_json_literal(payload: Any) -> str:
    json_text = json.dumps(payload, ensure_ascii=False)
    for marker in ("$json$", "$payload$", "$rows$"):
        if marker not in json_text:
            return f"{marker}{json_text}{marker}"
    raise ValueError("Unable to safely embed JSON payload in SQL.")


def _read_csv_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        return [dict(row) for row in reader]


def _parse_price(value: Any, *, field_name: str) -> int:
    normalized = str(value or "").strip()
    if not normalized:
        return 0
    try:
        decimal_value = Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError(f"{field_name} must be numeric, got {value!r}.") from exc
    if decimal_value != decimal_value.to_integral_value():
        raise ValueError(f"{field_name} must be an integer amount, got {value!r}.")
    integer_value = int(decimal_value)
    if integer_value < 0:
        raise ValueError(f"{field_name} must be zero or positive, got {value!r}.")
    return integer_value


def build_service_jan_code(product_name: str) -> str:
    normalized_name = str(product_name).strip()
    digest = hashlib.sha1(normalized_name.encode("utf-8")).hexdigest()[:16]
    return f"{AUTO_JAN_PREFIX}{digest}"


def prepare_product_seed_rows(rows: Sequence[Mapping[str, Any]]) -> PreparedProductSeedRows:
    actionable_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    skipped_rows = 0
    seen_names: set[str] = set()
    seen_jan_codes: set[str] = set()

    for row_number, row in enumerate(rows, start=2):
        product_name = str(row.get("product_name", "")).strip()
        jan_code_raw = str(row.get("jan_code", "")).strip()

        if not product_name and not jan_code_raw:
            skipped_rows += 1
            continue
        if not product_name:
            errors.append(f"Row {row_number}: product_name is required when seed data is set.")
            continue

        jan_code = jan_code_raw or build_service_jan_code(product_name)
        jan_code_provided = bool(jan_code_raw)

        try:
            cost_price = _parse_price(row.get("cost_price", ""), field_name="cost_price")
            selling_price = _parse_price(row.get("selling_price", ""), field_name="selling_price")
            is_active = _parse_bool(row.get("is_active", ""), default=True)
        except ValueError as exc:
            errors.append(f"Row {row_number}: {exc}")
            continue

        if product_name in seen_names:
            errors.append(f"Duplicate product_name detected: {product_name!r} (row {row_number}).")
            continue
        if jan_code in seen_jan_codes:
            errors.append(f"Duplicate jan_code detected: {jan_code!r} (row {row_number}).")
            continue
        seen_names.add(product_name)
        seen_jan_codes.add(jan_code)

        actionable_rows.append(
            {
                "product_name": product_name,
                "jan_code": jan_code,
                "jan_code_provided": jan_code_provided,
                "category": str(row.get("category", "")).strip(),
                "product_group": str(row.get("product_group", "")).strip(),
                "brand": str(row.get("brand", "")).strip(),
                "cost_price": cost_price,
                "selling_price": selling_price,
                "is_active": is_active,
            }
        )

    return PreparedProductSeedRows(
        actionable_rows=actionable_rows,
        skipped_rows=skipped_rows,
        errors=errors,
    )


def build_existing_products_lookup_sql(rows: Sequence[Mapping[str, Any]]) -> str:
    if not rows:
        raise ValueError("At least one product row is required for lookup.")

    payload = [
        {
            "product_name": str(row["product_name"]).strip(),
            "jan_code": str(row["jan_code"]).strip(),
        }
        for row in rows
    ]
    json_literal = _build_json_literal(payload)
    return f"""
WITH input_rows AS (
    SELECT
        product_name,
        jan_code
    FROM jsonb_to_recordset({json_literal}::jsonb) AS payload(
        product_name TEXT,
        jan_code TEXT
    )
)
SELECT DISTINCT
    p.id,
    p.jan_code,
    p.product_name
FROM public.products p
JOIN input_rows i
    ON p.product_name = i.product_name
    OR p.jan_code = i.jan_code
ORDER BY p.product_name, p.id;
""".strip()


def build_product_seed_upsert_sql(rows: Sequence[Mapping[str, Any]]) -> str:
    if not rows:
        raise ValueError("At least one product seed row is required.")

    payload = [
        {
            "product_name": str(row["product_name"]).strip(),
            "jan_code": str(row["jan_code"]).strip(),
            "jan_code_provided": bool(row.get("jan_code_provided", False)),
            "category": str(row.get("category", "")).strip(),
            "product_group": str(row.get("product_group", "")).strip(),
            "brand": str(row.get("brand", "")).strip(),
            "cost_price": int(row.get("cost_price", 0)),
            "selling_price": int(row.get("selling_price", 0)),
            "is_active": _parse_bool(row.get("is_active", True), default=True),
        }
        for row in rows
    ]
    json_literal = _build_json_literal(payload)

    return f"""
WITH input_rows AS (
    SELECT
        product_name,
        jan_code,
        jan_code_provided,
        category,
        product_group,
        brand,
        cost_price,
        selling_price,
        is_active
    FROM jsonb_to_recordset({json_literal}::jsonb) AS payload(
        product_name TEXT,
        jan_code TEXT,
        jan_code_provided BOOLEAN,
        category TEXT,
        product_group TEXT,
        brand TEXT,
        cost_price INTEGER,
        selling_price INTEGER,
        is_active BOOLEAN
    )
),
updated AS (
    UPDATE public.products p
    SET
        jan_code = CASE WHEN i.jan_code_provided THEN i.jan_code ELSE p.jan_code END,
        product_name = i.product_name,
        cost_price = i.cost_price,
        selling_price = i.selling_price,
        category = COALESCE(i.category, ''),
        markup_rate = CASE
            WHEN i.selling_price > 0
                THEN ROUND(((i.selling_price - i.cost_price)::NUMERIC / i.selling_price), 4)::REAL
            ELSE 0
        END,
        updated_at = NOW(),
        product_group = NULLIF(i.product_group, ''),
        brand = NULLIF(i.brand, ''),
        is_active = i.is_active
    FROM input_rows i
    WHERE p.product_name = i.product_name
    RETURNING i.product_name
),
upserted AS (
    INSERT INTO public.products (
        jan_code,
        product_name,
        cost_price,
        selling_price,
        category,
        markup_rate,
        updated_at,
        product_group,
        brand,
        is_active
    )
    SELECT
        i.jan_code,
        i.product_name,
        i.cost_price,
        i.selling_price,
        COALESCE(i.category, ''),
        CASE
            WHEN i.selling_price > 0
                THEN ROUND(((i.selling_price - i.cost_price)::NUMERIC / i.selling_price), 4)::REAL
            ELSE 0
        END,
        NOW(),
        NULLIF(i.product_group, ''),
        NULLIF(i.brand, ''),
        i.is_active
    FROM input_rows i
    LEFT JOIN updated u
        ON u.product_name = i.product_name
    WHERE u.product_name IS NULL
    ON CONFLICT (jan_code)
    DO UPDATE SET
        product_name = EXCLUDED.product_name,
        cost_price = EXCLUDED.cost_price,
        selling_price = EXCLUDED.selling_price,
        category = EXCLUDED.category,
        markup_rate = EXCLUDED.markup_rate,
        updated_at = NOW(),
        product_group = EXCLUDED.product_group,
        brand = EXCLUDED.brand,
        is_active = EXCLUDED.is_active
    RETURNING 1
)
SELECT (
    (SELECT COUNT(*) FROM updated)
    + (SELECT COUNT(*) FROM upserted)
)::INTEGER AS upserted_count;
""".strip()


def import_products_from_seed(
    *,
    csv_path: Path | str = DEFAULT_PRODUCT_IMPORT_CSV,
    query_runner: QueryRunner,
    apply: bool = False,
) -> ProductSeedImportResult:
    resolved_csv_path = Path(csv_path)
    raw_rows = _read_csv_rows(resolved_csv_path)
    prepared = prepare_product_seed_rows(raw_rows)
    errors = list(prepared.errors)

    if prepared.actionable_rows and not errors:
        existing_rows = query_runner(build_existing_products_lookup_sql(prepared.actionable_rows))
        existing_by_name: dict[str, list[Mapping[str, Any]]] = {}
        existing_by_jan_code: dict[str, Mapping[str, Any]] = {}
        for row in existing_rows:
            if not isinstance(row, Mapping):
                continue
            existing_name = str(row.get("product_name", "")).strip()
            existing_jan_code = str(row.get("jan_code", "")).strip()
            existing_by_name.setdefault(existing_name, []).append(row)
            if existing_jan_code and existing_jan_code not in existing_by_jan_code:
                existing_by_jan_code[existing_jan_code] = row

        for row in prepared.actionable_rows:
            product_name = str(row["product_name"]).strip()
            jan_code = str(row["jan_code"]).strip()
            name_matches = existing_by_name.get(product_name, [])
            jan_match = existing_by_jan_code.get(jan_code)

            if len(name_matches) > 1:
                errors.append(
                    f"Existing product_name {product_name!r} matched multiple rows; manual cleanup required."
                )
                continue

            if jan_match and str(jan_match.get("product_name", "")).strip() != product_name:
                errors.append(
                    f"jan_code {jan_code!r} already belongs to product_name "
                    f"{str(jan_match.get('product_name', '')).strip()!r}."
                )
                continue

            if row.get("jan_code_provided") and name_matches:
                existing_jan_code = str(name_matches[0].get("jan_code", "")).strip()
                if existing_jan_code and existing_jan_code != jan_code:
                    errors.append(
                        f"product_name {product_name!r} already exists with jan_code "
                        f"{existing_jan_code!r}; refusing to overwrite with {jan_code!r}."
                    )

    upserted_rows = 0
    if apply and prepared.actionable_rows and not errors:
        upsert_rows = query_runner(build_product_seed_upsert_sql(prepared.actionable_rows))
        if upsert_rows and isinstance(upsert_rows[0], Mapping):
            upserted_rows = int(upsert_rows[0].get("upserted_count", len(prepared.actionable_rows)))
        else:
            upserted_rows = len(prepared.actionable_rows)

    return ProductSeedImportResult(
        csv_path=resolved_csv_path,
        dry_run=not apply,
        total_rows=len(raw_rows),
        actionable_rows=len(prepared.actionable_rows),
        skipped_rows=prepared.skipped_rows,
        upserted_rows=upserted_rows,
        errors=errors,
    )
