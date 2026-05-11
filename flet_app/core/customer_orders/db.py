"""
客注管理用の Supabase REST アクセス層。
既存の在庫管理と同じく httpx を使い、軽量に CRUD を行う。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from flet_app.core.config import settings


TABLE_NAME = "customer_orders"

_REST_CLIENT = httpx.Client(
    base_url=f"{settings.SUPABASE_URL}/rest/v1/",
    headers={
        "apikey": settings.SUPABASE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    },
    timeout=httpx.Timeout(15.0, connect=5.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)


def _get_rest_client() -> httpx.Client:
    return _REST_CLIENT


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_customer_orders(statuses: list[str] | None = None, limit: int = 500) -> list[dict[str, Any]]:
    """客注一覧を取得する。"""
    params: dict[str, str] = {"select": "*", "limit": str(limit)}
    cleaned_statuses = [str(status).strip() for status in (statuses or []) if str(status).strip()]
    if len(cleaned_statuses) == 1:
        params["status"] = f"eq.{cleaned_statuses[0]}"
    elif len(cleaned_statuses) > 1:
        params["status"] = f"in.({','.join(cleaned_statuses)})"

    try:
        client = _get_rest_client()
        response = client.get(TABLE_NAME, params=params)
        response.raise_for_status()
        return response.json()
    except Exception as ex:
        raise RuntimeError(f"客注一覧の取得に失敗しました: {ex}") from ex


def get_customer_order(order_id: str) -> dict[str, Any] | None:
    """ID指定で客注を1件取得する。"""
    try:
        client = _get_rest_client()
        response = client.get(
            TABLE_NAME,
            params={"select": "*", "id": f"eq.{order_id}", "limit": "1"},
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if data else None
    except Exception as ex:
        raise RuntimeError(f"客注データの取得に失敗しました: {ex}") from ex


def create_customer_order(payload: dict[str, Any]) -> dict[str, Any]:
    """客注を新規登録する。"""
    record = dict(payload)
    now = _utc_now_iso()
    record.setdefault("status", "pending")
    record.setdefault("created_at", now)
    record["updated_at"] = now

    try:
        client = _get_rest_client()
        response = client.post(TABLE_NAME, json=record)
        response.raise_for_status()
        data = response.json()
        return data[0] if data else record
    except Exception as ex:
        raise RuntimeError(f"客注データの登録に失敗しました: {ex}") from ex


def update_customer_order(order_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """客注の内容を更新する。"""
    record = dict(payload)
    record["updated_at"] = _utc_now_iso()

    try:
        client = _get_rest_client()
        response = client.patch(
            TABLE_NAME,
            json=record,
            params={"id": f"eq.{order_id}"},
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if data else get_customer_order(order_id)
    except Exception as ex:
        raise RuntimeError(f"客注データの更新に失敗しました: {ex}") from ex


def update_customer_order_status(order_id: str, status: str) -> dict[str, Any] | None:
    """客注のステータスだけを更新する。"""
    return update_customer_order(order_id, {"status": status})


def delete_customer_order(order_id: str) -> bool:
    """客注を物理削除する。"""
    try:
        client = _get_rest_client()
        response = client.delete(
            TABLE_NAME,
            params={"id": f"eq.{order_id}"},
        )
        response.raise_for_status()
        return True
    except Exception as ex:
        raise RuntimeError(f"客注データの削除に失敗しました: {ex}") from ex
