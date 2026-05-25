from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from flet_app.core.sales.unmatched_export import DEFAULT_OUTPUT_DIR


DEFAULT_SOURCE_SYSTEM = "pos"
DEFAULT_IMPORT_CSV = DEFAULT_OUTPUT_DIR / "product_aliases_import_template.csv"
QueryRunner = Callable[[str], list[dict[str, Any]]]


@dataclass(frozen=True)
class PreparedImportRows:
    actionable_rows: list[dict[str, Any]]
    skipped_rows: int
    errors: list[str]


@dataclass(frozen=True)
class ProductAliasImportResult:
    csv_path: Path
    dry_run: bool
    total_rows: int
    actionable_rows: int
    skipped_rows: int
    upserted_rows: int
    errors: list[str]
    missing_product_ids: list[int]


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


def prepare_import_rows(rows: Sequence[Mapping[str, Any]]) -> PreparedImportRows:
    actionable_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    skipped_rows = 0
    seen_keys: set[tuple[str, str]] = set()

    for row_number, row in enumerate(rows, start=2):
        alias_name = str(row.get("alias_name", "")).strip()
        product_id_raw = str(row.get("product_id", "")).strip()

        if not alias_name and not product_id_raw:
            skipped_rows += 1
            continue
        if not alias_name:
            errors.append(f"Row {row_number}: alias_name is required when product_id is set.")
            continue
        if not product_id_raw:
            skipped_rows += 1
            continue

        try:
            product_id = int(product_id_raw)
        except ValueError:
            errors.append(f"Row {row_number}: product_id must be an integer, got {product_id_raw!r}.")
            continue

        source_system = str(row.get("source_system", "")).strip() or DEFAULT_SOURCE_SYSTEM
        try:
            is_active = _parse_bool(row.get("is_active", ""), default=True)
        except ValueError as exc:
            errors.append(f"Row {row_number}: {exc}")
            continue

        dedupe_key = (alias_name, source_system)
        if dedupe_key in seen_keys:
            errors.append(
                "Duplicate alias/source detected: "
                f"alias_name={alias_name!r}, source_system={source_system!r} (row {row_number})."
            )
            continue
        seen_keys.add(dedupe_key)

        actionable_rows.append(
            {
                "alias_name": alias_name,
                "product_id": product_id,
                "source_system": source_system,
                "is_active": is_active,
            }
        )

    return PreparedImportRows(
        actionable_rows=actionable_rows,
        skipped_rows=skipped_rows,
        errors=errors,
    )


def build_product_validation_sql(product_ids: Sequence[int]) -> str:
    unique_ids = sorted({int(product_id) for product_id in product_ids})
    if not unique_ids:
        raise ValueError("At least one product_id is required for validation.")

    id_list = ", ".join(str(product_id) for product_id in unique_ids)
    return (
        "SELECT id "
        "FROM public.products "
        f"WHERE id IN ({id_list}) "
        "ORDER BY id"
    )


def build_product_alias_upsert_sql(rows: Sequence[Mapping[str, Any]]) -> str:
    if not rows:
        raise ValueError("At least one product alias row is required.")

    payload = [
        {
            "alias_name": str(row["alias_name"]).strip(),
            "product_id": int(row["product_id"]),
            "source_system": str(row.get("source_system", DEFAULT_SOURCE_SYSTEM)).strip()
            or DEFAULT_SOURCE_SYSTEM,
            "is_active": _parse_bool(row.get("is_active", True), default=True),
        }
        for row in rows
    ]
    json_literal = _build_json_literal(payload)

    return f"""
WITH input_rows AS (
    SELECT
        alias_name,
        product_id,
        source_system,
        is_active
    FROM jsonb_to_recordset({json_literal}::jsonb) AS payload(
        alias_name TEXT,
        product_id INTEGER,
        source_system TEXT,
        is_active BOOLEAN
    )
),
upserted AS (
    INSERT INTO public.product_aliases (
        alias_name,
        product_id,
        source_system,
        is_active,
        updated_at
    )
    SELECT
        alias_name,
        product_id,
        source_system,
        is_active,
        NOW()
    FROM input_rows
    ON CONFLICT (alias_name, source_system)
    DO UPDATE SET
        product_id = EXCLUDED.product_id,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    RETURNING 1
)
SELECT COUNT(*)::INTEGER AS upserted_count
FROM upserted;
""".strip()


def import_product_aliases(
    *,
    csv_path: Path | str = DEFAULT_IMPORT_CSV,
    query_runner: QueryRunner,
    apply: bool = False,
) -> ProductAliasImportResult:
    resolved_csv_path = Path(csv_path)
    raw_rows = _read_csv_rows(resolved_csv_path)
    prepared = prepare_import_rows(raw_rows)
    errors = list(prepared.errors)
    missing_product_ids: list[int] = []
    upserted_rows = 0

    if prepared.actionable_rows and not errors:
        validation_rows = query_runner(
            build_product_validation_sql(
                [int(row["product_id"]) for row in prepared.actionable_rows]
            )
        )
        existing_ids = {
            int(row["id"])
            for row in validation_rows
            if isinstance(row, Mapping) and row.get("id") is not None
        }
        missing_product_ids = sorted(
            {
                int(row["product_id"])
                for row in prepared.actionable_rows
                if int(row["product_id"]) not in existing_ids
            }
        )
        if missing_product_ids:
            errors.append(
                "Unknown product_id values: "
                + ", ".join(str(product_id) for product_id in missing_product_ids)
            )

    if apply and prepared.actionable_rows and not errors:
        upsert_rows = query_runner(build_product_alias_upsert_sql(prepared.actionable_rows))
        if upsert_rows and isinstance(upsert_rows[0], Mapping):
            upserted_rows = int(upsert_rows[0].get("upserted_count", len(prepared.actionable_rows)))
        else:
            upserted_rows = len(prepared.actionable_rows)

    return ProductAliasImportResult(
        csv_path=resolved_csv_path,
        dry_run=not apply,
        total_rows=len(raw_rows),
        actionable_rows=len(prepared.actionable_rows),
        skipped_rows=prepared.skipped_rows,
        upserted_rows=upserted_rows,
        errors=errors,
        missing_product_ids=missing_product_ids,
    )
