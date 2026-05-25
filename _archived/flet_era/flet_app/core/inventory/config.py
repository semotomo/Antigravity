"""
商品管理用の設定定数。
Streamlit版で使っていたCSVマッピングを Flet 側でも共通利用する。
"""

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
