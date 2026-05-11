import time
from typing import List, Dict, Optional
from flet_app.core.config import settings
from flet_app.core.supabase_client import supabase

_SALES_CACHE: dict[tuple[str, int], tuple[float, List[Dict]]] = {}
_SALES_CACHE_TTL = 60.0

def get_product_sales_data(token: str, limit: int = 1000) -> List[Dict]:
    """Retrieve POS product sales data from Supabase."""
    cache_key = (token, limit)
    now = time.monotonic()
    cached = _SALES_CACHE.get(cache_key)
    if cached and now - cached[0] < _SALES_CACHE_TTL:
        return cached[1]

    params = {
        "select": "store_name,product_name,quantity,total_amount,transaction_date",
        "order": "transaction_date.desc,total_amount.desc",
        "limit": str(limit)
    }

    data = supabase.rest_get("product_sales_data", token=token, params=params).json()
    _SALES_CACHE[cache_key] = (now, data)
    return data
