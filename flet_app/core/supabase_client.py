import httpx
from flet_app.core.config import settings

class SupabaseAuthClient:
    def __init__(self, url: str, key: str):
        if not url or not key:
            raise ValueError("Supabase URL and Key must be set in Environment Variables or secrets.toml")
        self.url = url
        self.key = key
        timeout = httpx.Timeout(15.0, connect=5.0)
        limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
        self._client = httpx.Client(http2=True, timeout=timeout, limits=limits)
        self._rest_client = httpx.Client(
            base_url=f"{self.url}/rest/v1/",
            http2=True,
            timeout=timeout,
            limits=limits,
        )

    def _headers(self, additional_headers=None):
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        if additional_headers:
            headers.update(additional_headers)
        return headers

    def rest_get(self, path: str, token: str | None = None, params=None) -> httpx.Response:
        headers = self._headers({"Authorization": f"Bearer {token}"} if token else None)
        response = self._rest_client.get(path, headers=headers, params=params)
        response.raise_for_status()
        return response

    def sign_in_with_password(self, email: str, password: str) -> dict:
        """
        Supabase GoTrue API (Auth)
        """
        resp = self._client.post(
            f"{self.url}/auth/v1/token?grant_type=password",
            headers={"apikey": self.key, "Content-Type": "application/json"},
            json={"email": email, "password": password}
        )
        if resp.status_code >= 400:
            error_data = resp.json()
            error_msg = error_data.get("error_description") or error_data.get("msg") or str(error_data)
            raise Exception(error_msg)
        return resp.json()
        
    def sign_out(self, token: str) -> bool:
        """
        Sign out
        """
        resp = self._client.post(
            f"{self.url}/auth/v1/logout",
            headers={"apikey": self.key, "Authorization": f"Bearer {token}"}
        )
        return resp.status_code == 204

supabase = SupabaseAuthClient(settings.SUPABASE_URL, settings.SUPABASE_KEY)
