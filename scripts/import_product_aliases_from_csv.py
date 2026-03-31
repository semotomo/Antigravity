from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from flet_app.core.sales.product_alias_import import (
    DEFAULT_IMPORT_CSV,
    import_product_aliases,
)
from flet_app.core.sales.unmatched_export import extract_json_payload


def run_supabase_query(sql: str) -> list[dict]:
    temp_sql_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".sql",
            encoding="utf-8",
            delete=False,
            dir=PROJECT_ROOT,
        ) as temp_file:
            temp_file.write(sql)
            temp_sql_path = Path(temp_file.name)

        command = [
            "npx.cmd",
            "supabase",
            "db",
            "query",
            "--linked",
            "--output",
            "json",
            "--agent=no",
            "--file",
            str(temp_sql_path),
        ]
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    finally:
        if temp_sql_path is not None and temp_sql_path.exists():
            temp_sql_path.unlink()
    if completed.returncode != 0:
        raise RuntimeError(
            "Supabase CLI query failed.\n"
            f"STDOUT:\n{completed.stdout}\n"
            f"STDERR:\n{completed.stderr}"
        )
    payload = extract_json_payload(completed.stdout)
    if not isinstance(payload, list):
        raise TypeError("Supabase CLI query did not return a JSON array.")
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate or upsert product_aliases rows from a CSV template."
    )
    parser.add_argument(
        "--csv-path",
        default=str(DEFAULT_IMPORT_CSV),
        help="CSV path generated from the unmatched sales export template.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply upserts after validation. Default is dry-run validation only.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = import_product_aliases(
        csv_path=Path(args.csv_path),
        query_runner=run_supabase_query,
        apply=args.apply,
    )
    print(
        json.dumps(
            {
                "csv_path": str(result.csv_path),
                "dry_run": result.dry_run,
                "total_rows": result.total_rows,
                "actionable_rows": result.actionable_rows,
                "skipped_rows": result.skipped_rows,
                "upserted_rows": result.upserted_rows,
                "missing_product_ids": result.missing_product_ids,
                "errors": result.errors,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if not result.errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
