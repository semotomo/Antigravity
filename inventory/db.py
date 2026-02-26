"""
Supabase データベース操作モジュール
Supabase REST API を httpx で直接呼び出す軽量実装。
Windows環境でのC++コンパイラ不要。
"""

import streamlit as st
import pandas as pd
import httpx
from datetime import datetime, timezone
from typing import Optional


def _get_supabase_config() -> tuple[str, str]:
    """Supabaseの接続情報をsecretsから取得"""
    url = st.secrets["supabase"]["url"]
    key = st.secrets["supabase"]["key"]
    return url, key


def _headers() -> dict:
    """Supabase REST APIの共通ヘッダー"""
    _, key = _get_supabase_config()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _rest_url(table: str) -> str:
    """テーブルのREST APIエンドポイントURL"""
    url, _ = _get_supabase_config()
    return f"{url}/rest/v1/{table}"


# ============================================
# 店舗マスタ操作
# ============================================

@st.cache_data(ttl=300)
def get_stores() -> list[dict]:
    """全店舗を取得"""
    try:
        resp = httpx.get(
            _rest_url("stores"),
            headers=_headers(),
            params={"select": "*", "order": "id.asc"},
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        st.error(f"店舗データ取得エラー: {e}")
        return []


def add_store(name: str) -> bool:
    """店舗を追加"""
    try:
        resp = httpx.post(
            _rest_url("stores"),
            headers=_headers(),
            json={"name": name},
        )
        resp.raise_for_status()
        # キャッシュをクリア
        get_stores.clear()
        return True
    except Exception as e:
        st.error(f"店舗追加エラー: {e}")
        return False


def delete_store(store_id: int) -> bool:
    """店舗を削除"""
    try:
        resp = httpx.delete(
            _rest_url("stores"),
            headers=_headers(),
            params={"id": f"eq.{store_id}"},
        )
        resp.raise_for_status()
        # キャッシュをクリア
        get_stores.clear()
        return True
    except Exception as e:
        st.error(f"店舗削除エラー: {e}")
        return False


# ============================================
# 商品マスタ操作
# ============================================

def add_or_update_product(product_data: dict) -> bool:
    """商品を1件追加または更新（JANコードで判定）"""
    try:
        headers = _headers()
        headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        resp = httpx.post(
            _rest_url("products"),
            headers=headers,
            json=product_data,
            params={"on_conflict": "jan_code"},
        )
        resp.raise_for_status()
        get_all_products.clear()
        return True
    except Exception as e:
        st.error(f"商品登録エラー: {e}")
        return False


def delete_product(jan_code: str) -> bool:
    """JANコードで商品を削除"""
    try:
        resp = httpx.delete(
            _rest_url("products"),
            headers=_headers(),
            params={"jan_code": f"eq.{jan_code}"},
        )
        resp.raise_for_status()
        get_all_products.clear()
        return True
    except Exception as e:
        st.error(f"商品削除エラー: {e}")
        return False


def search_product_by_jan(jan_code: str) -> Optional[dict]:
    """JANコードで商品を検索"""
    try:
        resp = httpx.get(
            _rest_url("products"),
            headers=_headers(),
            params={"select": "*", "jan_code": f"eq.{jan_code}"},
        )
        resp.raise_for_status()
        data = resp.json()
        return data[0] if data else None
    except Exception as e:
        st.error(f"商品検索エラー: {e}")
        return None


@st.cache_data(ttl=60)
def get_all_products(limit: int = 100, offset: int = 0) -> list[dict]:
    """商品一覧を取得"""
    try:
        headers = _headers()
        headers["Range"] = f"{offset}-{offset + limit - 1}"
        resp = httpx.get(
            _rest_url("products"),
            headers=headers,
            params={"select": "*", "order": "product_name.asc"},
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        st.error(f"商品一覧取得エラー: {e}")
        return []


def get_product_count() -> int:
    """商品の総数を取得"""
    try:
        headers = _headers()
        headers["Prefer"] = "count=exact"
        headers["Range-Unit"] = "items"
        resp = httpx.head(
            _rest_url("products"),
            headers=headers,
            params={"select": "id"},
        )
        resp.raise_for_status()
        # Content-Range ヘッダーから総数を取得
        content_range = resp.headers.get("content-range", "")
        if "/" in content_range:
            total = content_range.split("/")[-1]
            return int(total) if total != "*" else 0
        return 0
    except Exception as e:
        st.error(f"商品数取得エラー: {e}")
        return 0


def upsert_products_from_csv(df: pd.DataFrame) -> tuple[int, int]:
    """
    CSVデータから商品マスタを一括更新（upsert）

    Returns:
        (成功件数, エラー件数)
    """
    success_count = 0
    error_count = 0

    # DataFrameのカラムを正規化
    records = _normalize_product_dataframe(df)

    if not records:
        return 0, 0

    # バッチ処理（100件ずつ）
    headers = _headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=representation"

    batch_size = 100
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            resp = httpx.post(
                _rest_url("products"),
                headers=headers,
                json=batch,
                params={"on_conflict": "jan_code"},
                timeout=30.0,
            )
            resp.raise_for_status()
            success_count += len(batch)
        except Exception as e:
            st.warning(f"バッチ {i // batch_size + 1} でエラー: {e}")
            error_count += len(batch)

    # キャッシュクリア
    get_all_products.clear()

    return success_count, error_count


def _normalize_product_dataframe(df: pd.DataFrame) -> list[dict]:
    """
    CSVのDataFrameを正規化して、DBに投入できる辞書リストに変換

    対応フォーマット:
    - ヘッダー付きCSV（カラム名で判定）
    - 「商品一覧貼付用」形式（位置ベースで判定）
    """
    from .config import CSV_COLUMN_MAP, CSV_HEADER_MAP

    records = []

    # ヘッダー名チェック — カラム名がマッピングに存在するか
    col_names = [str(c).strip() for c in df.columns]
    mapped_cols = {}
    for col_name in col_names:
        if col_name in CSV_HEADER_MAP:
            mapped_cols[CSV_HEADER_MAP[col_name]] = col_name

    if "jan_code" in mapped_cols:
        # ヘッダー付きCSVとして処理
        for _, row in df.iterrows():
            jan = str(row.get(mapped_cols.get("jan_code", ""), "")).strip()
            if not jan or jan == "0" or jan == "nan":
                continue

            record = {
                "jan_code": jan,
                "product_name": str(row.get(mapped_cols.get("product_name", ""), "")).strip(),
                "cost_price": _safe_int(row.get(mapped_cols.get("cost_price", ""), 0)),
                "selling_price": _safe_int(row.get(mapped_cols.get("selling_price", ""), 0)),
                "category": str(row.get(mapped_cols.get("category", ""), "")).strip(),
                "markup_rate": _safe_float(row.get(mapped_cols.get("markup_rate", ""), 0)),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            records.append(record)
    else:
        # 位置ベース（「商品一覧貼付用」形式）で処理
        for _, row in df.iterrows():
            values = list(row)

            # D列（index 3）にJANコードがある想定
            jan_idx = CSV_COLUMN_MAP["jan_code"]
            if jan_idx >= len(values):
                continue

            jan = str(values[jan_idx]).strip() if pd.notna(values[jan_idx]) else ""
            if not jan or jan == "0" or jan == "nan":
                continue

            # 各フィールドを位置ベースで取得
            def get_val(key, default=""):
                idx = CSV_COLUMN_MAP.get(key, -1)
                if 0 <= idx < len(values) and pd.notna(values[idx]):
                    return values[idx]
                return default

            record = {
                "jan_code": jan,
                "product_name": str(get_val("product_name", "")).strip(),
                "cost_price": _safe_int(get_val("cost_price", 0)),
                "selling_price": _safe_int(get_val("selling_price", 0)),
                "category": str(get_val("category", "")).strip(),
                "markup_rate": 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

            # かけ率を計算
            if record["selling_price"] > 0:
                record["markup_rate"] = round(
                    record["cost_price"] / record["selling_price"], 4
                )

            records.append(record)

    return records


# ============================================
# 移動履歴操作
# ============================================

def add_transfer(
    from_store_id: int,
    to_store_id: int,
    jan_code: str,
    product_name: str,
    quantity: int,
    cost_price: int,
    selling_price: int,
    memo: str = ""
) -> bool:
    """移動記録を1件追加"""
    try:
        resp = httpx.post(
            _rest_url("transfers"),
            headers=_headers(),
            json={
                "transfer_date": datetime.now(timezone.utc).isoformat(),
                "from_store_id": from_store_id,
                "to_store_id": to_store_id,
                "jan_code": jan_code,
                "product_name": product_name,
                "quantity": quantity,
                "cost_price": cost_price,
                "total_cost": cost_price * quantity,
                "selling_price": selling_price,
                "memo": memo,
            },
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        st.error(f"移動記録の保存エラー: {e}")
        return False


def add_transfers_batch(transfers: list[dict]) -> bool:
    """移動記録を一括追加"""
    try:
        now = datetime.now(timezone.utc).isoformat()

        records = []
        for t in transfers:
            records.append({
                "transfer_date": now,
                "from_store_id": t["from_store_id"],
                "to_store_id": t["to_store_id"],
                "jan_code": t["jan_code"],
                "product_name": t["product_name"],
                "quantity": t["quantity"],
                "cost_price": t["cost_price"],
                "total_cost": t["cost_price"] * t["quantity"],
                "selling_price": t["selling_price"],
                "memo": t.get("memo", ""),
            })

        resp = httpx.post(
            _rest_url("transfers"),
            headers=_headers(),
            json=records,
            timeout=30.0,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        st.error(f"一括保存エラー: {e}")
        return False


def get_transfers(
    from_store_id: Optional[int] = None,
    to_store_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 500
) -> list[dict]:
    """移動履歴を検索"""
    try:
        params = {
            "select": "*, from_store:stores!transfers_from_store_id_fkey(name), to_store:stores!transfers_to_store_id_fkey(name)",
            "order": "transfer_date.desc",
            "limit": str(limit),
        }

        if from_store_id:
            params["from_store_id"] = f"eq.{from_store_id}"
        if to_store_id:
            params["to_store_id"] = f"eq.{to_store_id}"
        if date_from:
            params["transfer_date"] = f"gte.{date_from}T00:00:00+00:00"
        if date_to:
            # 日付の終わりまで含める
            if "transfer_date" in params:
                # 範囲指定の場合はandで結合
                params["and"] = f"(transfer_date.gte.{date_from}T00:00:00+00:00,transfer_date.lte.{date_to}T23:59:59+00:00)"
                del params["transfer_date"]
            else:
                params["transfer_date"] = f"lte.{date_to}T23:59:59+00:00"

        resp = httpx.get(
            _rest_url("transfers"),
            headers=_headers(),
            params=params,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        st.error(f"履歴取得エラー: {e}")
        return []


def delete_transfer(transfer_id: int) -> bool:
    """移動記録を1件削除"""
    try:
        resp = httpx.delete(
            _rest_url("transfers"),
            headers=_headers(),
            params={"id": f"eq.{transfer_id}"},
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        st.error(f"削除エラー: {e}")
        return False


# ============================================
# ユーティリティ
# ============================================

def _safe_int(value) -> int:
    """値を安全にintに変換"""
    try:
        if pd.isna(value):
            return 0
        return int(float(value))
    except (ValueError, TypeError):
        return 0


def _safe_float(value) -> float:
    """値を安全にfloatに変換"""
    try:
        if pd.isna(value):
            return 0.0
        return float(value)
    except (ValueError, TypeError):
        return 0.0
