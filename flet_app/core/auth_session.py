from __future__ import annotations

import flet as ft

from flet_app.core.supabase_client import supabase


AUTH_STORAGE_KEYS = {
    "access_token": "auth.access_token",
    "refresh_token": "auth.refresh_token",
    "user_email": "auth.user_email",
}


def apply_auth_session(page: ft.Page, auth_payload: dict | None) -> bool:
    payload = auth_payload or {}
    access_token = str(payload.get("access_token") or "").strip()
    refresh_token = str(payload.get("refresh_token") or "").strip()
    user_email = str(payload.get("user_email") or payload.get("email") or "").strip()
    is_authenticated = bool(access_token)

    setattr(page, "is_authenticated", is_authenticated)
    setattr(page, "access_token", access_token or None)
    setattr(page, "refresh_token", refresh_token or None)
    setattr(page, "user_email", user_email or None)
    return is_authenticated


async def _get_preferences() -> ft.SharedPreferences:
    return ft.SharedPreferences()


async def persist_auth_session(auth_payload: dict) -> None:
    try:
        prefs = await _get_preferences()
        await prefs.set(AUTH_STORAGE_KEYS["access_token"], str(auth_payload.get("access_token") or ""))
        await prefs.set(AUTH_STORAGE_KEYS["refresh_token"], str(auth_payload.get("refresh_token") or ""))
        await prefs.set(
            AUTH_STORAGE_KEYS["user_email"],
            str(auth_payload.get("user_email") or auth_payload.get("email") or ""),
        )
    except Exception:
        return


async def clear_persisted_auth_session() -> None:
    try:
        prefs = await _get_preferences()
        for key in AUTH_STORAGE_KEYS.values():
            await prefs.remove(key)
    except Exception:
        return


async def restore_auth_session(page: ft.Page) -> bool:
    try:
        prefs = await _get_preferences()
        stored_session = {
            "access_token": await prefs.get(AUTH_STORAGE_KEYS["access_token"]),
            "refresh_token": await prefs.get(AUTH_STORAGE_KEYS["refresh_token"]),
            "user_email": await prefs.get(AUTH_STORAGE_KEYS["user_email"]),
        }
    except Exception:
        apply_auth_session(page, None)
        return False

    access_token = str(stored_session.get("access_token") or "").strip()
    refresh_token = str(stored_session.get("refresh_token") or "").strip()

    if not access_token and not refresh_token:
        apply_auth_session(page, None)
        return False

    refreshed_session = None
    if refresh_token:
        try:
            refresh_response = supabase.refresh_session(refresh_token)
            if "access_token" in refresh_response:
                refreshed_session = {
                    "access_token": refresh_response.get("access_token"),
                    "refresh_token": refresh_response.get("refresh_token", refresh_token),
                    "user_email": refresh_response.get("user", {}).get(
                        "email", stored_session.get("user_email")
                    ),
                }
        except Exception:
            refreshed_session = None

    session_to_apply = refreshed_session or stored_session
    restored = apply_auth_session(page, session_to_apply)
    if restored:
        await persist_auth_session(session_to_apply)
        return True

    await clear_persisted_auth_session()
    return False


async def logout_page(page: ft.Page) -> None:
    token = getattr(page, "access_token", None)
    if token:
        try:
            supabase.sign_out(token)
        except Exception:
            pass

    apply_auth_session(page, None)
    await clear_persisted_auth_session()
