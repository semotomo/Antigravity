from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from flet_app.core.sales.unmatched_export import (
    DEFAULT_OUTPUT_DIR,
    export_unmatched_sales_reports,
    extract_json_payload,
)


def run_supabase_query(sql: str) -> list[dict]:
    command = [
        "npx.cmd",
        "supabase",
        "db",
        "query",
        "--linked",
        "--output",
        "json",
        "--agent=no",
        sql,
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
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
        description="Export unmatched sales candidates and a product_aliases import template."
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory to write CSV and JSON exports into.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional row limit for unmatched candidate summary export.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    artifacts = export_unmatched_sales_reports(
        query_runner=run_supabase_query,
        output_dir=Path(args.output_dir),
        limit=args.limit,
    )
    print(
        json.dumps(
            {
                "summary_csv": str(artifacts.summary_csv),
                "alias_template_csv": str(artifacts.alias_template_csv),
                "product_seed_csv": str(artifacts.product_seed_csv),
                "summary_json": str(artifacts.summary_json),
                "row_count": artifacts.row_count,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
