"""
設定ファイル — 店舗やアプリ全体の定数を管理
"""

# アプリケーション設定
APP_TITLE = "📦 商品移動管理システム"
APP_ICON = "📦"

# ページ設定
PAGE_TRANSFER = "移動入力"
PAGE_HISTORY = "移動履歴"
PAGE_PRODUCTS = "商品マスタ管理"

PAGES = [PAGE_TRANSFER, PAGE_HISTORY, PAGE_PRODUCTS]

# CSV読み込み時のカラムマッピング
# 「商品一覧貼付用」シートの構造に対応
CSV_COLUMN_MAP = {
    "jan_code": 3,       # D列 (0始まり: index=3)
    "category": 5,       # F列
    "product_name": 6,   # G列
    "selling_price": 8,  # I列
    "cost_price": 11,    # L列
}

# CSVカラム名マッピング（ヘッダーがある場合の対応）
CSV_HEADER_MAP = {
    "JANコード": "jan_code",
    "JAN": "jan_code",
    "jan_code": "jan_code",
    "商品名": "product_name",
    "原価": "cost_price",
    "売価": "selling_price",
    "商品区分": "category",
    "かけ率": "markup_rate",
}
