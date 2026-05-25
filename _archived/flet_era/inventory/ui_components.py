"""
共通UIコンポーネント — 各画面で使い回すUI部品
"""

import streamlit as st


def apply_custom_css():
    """iPad対応のカスタムCSSを適用"""
    st.markdown("""
    <style>
        /* ===== 全体レイアウト ===== */
        .main .block-container {
            max-width: 900px;
            padding-top: 1rem;
            padding-bottom: 2rem;
        }

        /* ===== iPad向け — タッチしやすいボタン・入力欄 ===== */
        .stButton > button {
            min-height: 48px;
            font-size: 1.1rem;
            border-radius: 10px;
            font-weight: 600;
        }

        .stTextInput > div > div > input {
            min-height: 48px;
            font-size: 1.1rem;
            border-radius: 8px;
        }

        .stNumberInput > div > div > input {
            min-height: 48px;
            font-size: 1.1rem;
        }

        .stSelectbox > div > div {
            min-height: 48px;
        }

        /* ===== 商品情報カード ===== */
        .product-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.2rem;
            border-radius: 12px;
            margin: 0.8rem 0;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }

        .product-card h3 {
            margin: 0 0 0.5rem 0;
            font-size: 1.3rem;
        }

        .product-card .price-info {
            display: flex;
            gap: 1.5rem;
            font-size: 1rem;
        }

        /* ===== 移動リストのアイテム ===== */
        .transfer-item {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 0.8rem 1rem;
            border-radius: 0 8px 8px 0;
            margin: 0.4rem 0;
        }

        .transfer-item .item-name {
            font-weight: 600;
            font-size: 1.05rem;
        }

        .transfer-item .item-detail {
            color: #666;
            font-size: 0.9rem;
        }

        /* ===== 統計カード ===== */
        .stat-card {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 12px;
            padding: 1rem;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }

        .stat-card .stat-value {
            font-size: 1.8rem;
            font-weight: 700;
            color: #667eea;
        }

        .stat-card .stat-label {
            font-size: 0.85rem;
            color: #888;
            margin-top: 0.2rem;
        }

        /* ===== 成功/警告メッセージのアニメーション ===== */
        .stSuccess, .stWarning, .stError {
            border-radius: 10px !important;
        }

        /* ===== サイドバー調整 ===== */
        section[data-testid="stSidebar"] {
            min-width: 260px;
            max-width: 320px;
        }

        section[data-testid="stSidebar"] .stRadio > label {
            font-size: 1.1rem;
            padding: 0.3rem 0;
        }

        /* ===== テーブル — iPad向け調整 ===== */
        .stDataFrame {
            font-size: 0.95rem;
        }

        /* ===== 登録ボタン（大きく目立つ） ===== */
        .big-button > button {
            width: 100%;
            min-height: 60px;
            font-size: 1.3rem !important;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            color: white !important;
            border: none !important;
            border-radius: 12px !important;
            font-weight: 700 !important;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4) !important;
        }

        .big-button > button:hover {
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6) !important;
            transform: translateY(-1px);
        }

        /* ===== 削除ボタン ===== */
        .delete-button > button {
            background: #ff4757 !important;
            color: white !important;
            border: none !important;
            min-height: 36px !important;
            font-size: 0.85rem !important;
        }
    </style>
    """, unsafe_allow_html=True)


def show_product_card(product: dict):
    """商品情報をカード形式で表示"""
    st.markdown(f"""
    <div class="product-card">
        <h3>🏷️ {product.get('product_name', '不明')}</h3>
        <div class="price-info">
            <span>📋 区分: {product.get('category', '-')}</span>
            <span>💰 原価: ¥{product.get('cost_price', 0):,}</span>
            <span>🏪 売価: ¥{product.get('selling_price', 0):,}</span>
        </div>
    </div>
    """, unsafe_allow_html=True)


def show_transfer_item(item: dict, index: int):
    """移動リストの1アイテムを表示"""
    st.markdown(f"""
    <div class="transfer-item">
        <div class="item-name">{item.get('product_name', '不明')}</div>
        <div class="item-detail">
            JAN: {item.get('jan_code', '-')} ｜
            数量: {item.get('quantity', 1)} ｜
            原価合計: ¥{item.get('cost_price', 0) * item.get('quantity', 1):,}
        </div>
    </div>
    """, unsafe_allow_html=True)


def show_stat_cards(stats: dict):
    """統計カードを横並びで表示"""
    cols = st.columns(len(stats))
    for col, (label, value) in zip(cols, stats.items()):
        with col:
            st.markdown(f"""
            <div class="stat-card">
                <div class="stat-value">{value}</div>
                <div class="stat-label">{label}</div>
            </div>
            """, unsafe_allow_html=True)
