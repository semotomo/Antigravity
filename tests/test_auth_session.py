import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flet_app.core.auth_session import (
    AUTH_STORAGE_KEYS,
    apply_auth_session,
    clear_persisted_auth_session,
    logout_page,
    persist_auth_session,
    restore_auth_session,
)


class FakeSharedPreferences:
    def __init__(self, initial_values=None):
        self.values = dict(initial_values or {})
        self.set_calls = []
        self.remove_calls = []

    async def set(self, key, value):
        self.values[key] = value
        self.set_calls.append((key, value))
        return True

    async def get(self, key):
        return self.values.get(key)

    async def remove(self, key):
        self.values.pop(key, None)
        self.remove_calls.append(key)
        return True


class AuthSessionTests(unittest.IsolatedAsyncioTestCase):
    def test_apply_auth_session_sets_page_attributes(self):
        page = SimpleNamespace()

        restored = apply_auth_session(
            page,
            {
                "access_token": "access-1",
                "refresh_token": "refresh-1",
                "user_email": "staff@example.com",
            },
        )

        self.assertTrue(restored)
        self.assertTrue(page.is_authenticated)
        self.assertEqual(page.access_token, "access-1")
        self.assertEqual(page.refresh_token, "refresh-1")
        self.assertEqual(page.user_email, "staff@example.com")

    async def test_persist_and_clear_auth_session_uses_shared_preferences(self):
        prefs = FakeSharedPreferences()

        with patch("flet_app.core.auth_session.ft.SharedPreferences", return_value=prefs):
            await persist_auth_session(
                {
                    "access_token": "access-1",
                    "refresh_token": "refresh-1",
                    "user_email": "staff@example.com",
                }
            )
            await clear_persisted_auth_session()

        self.assertIn((AUTH_STORAGE_KEYS["access_token"], "access-1"), prefs.set_calls)
        self.assertIn(AUTH_STORAGE_KEYS["access_token"], prefs.remove_calls)
        self.assertIn(AUTH_STORAGE_KEYS["refresh_token"], prefs.remove_calls)
        self.assertIn(AUTH_STORAGE_KEYS["user_email"], prefs.remove_calls)

    async def test_restore_auth_session_refreshes_tokens_when_refresh_token_exists(self):
        page = SimpleNamespace()
        prefs = FakeSharedPreferences(
            {
                AUTH_STORAGE_KEYS["access_token"]: "stale-access",
                AUTH_STORAGE_KEYS["refresh_token"]: "refresh-1",
                AUTH_STORAGE_KEYS["user_email"]: "old@example.com",
            }
        )

        with (
            patch("flet_app.core.auth_session.ft.SharedPreferences", return_value=prefs),
            patch(
                "flet_app.core.auth_session.supabase.refresh_session",
                return_value={
                    "access_token": "fresh-access",
                    "refresh_token": "fresh-refresh",
                    "user": {"email": "new@example.com"},
                },
            ) as mock_refresh,
        ):
            restored = await restore_auth_session(page)

        self.assertTrue(restored)
        self.assertTrue(page.is_authenticated)
        self.assertEqual(page.access_token, "fresh-access")
        self.assertEqual(page.refresh_token, "fresh-refresh")
        self.assertEqual(page.user_email, "new@example.com")
        mock_refresh.assert_called_once_with("refresh-1")

    async def test_logout_page_clears_page_state_and_persisted_values(self):
        page = SimpleNamespace(
            is_authenticated=True,
            access_token="access-1",
            refresh_token="refresh-1",
            user_email="staff@example.com",
        )
        prefs = FakeSharedPreferences(
            {
                AUTH_STORAGE_KEYS["access_token"]: "access-1",
                AUTH_STORAGE_KEYS["refresh_token"]: "refresh-1",
                AUTH_STORAGE_KEYS["user_email"]: "staff@example.com",
            }
        )

        with (
            patch("flet_app.core.auth_session.ft.SharedPreferences", return_value=prefs),
            patch("flet_app.core.auth_session.supabase.sign_out", return_value=True) as mock_sign_out,
        ):
            await logout_page(page)

        self.assertFalse(page.is_authenticated)
        self.assertIsNone(page.access_token)
        self.assertIsNone(page.refresh_token)
        self.assertIsNone(page.user_email)
        mock_sign_out.assert_called_once_with("access-1")
        self.assertEqual(prefs.values, {})


if __name__ == "__main__":
    unittest.main()
