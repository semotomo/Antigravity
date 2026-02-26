"""
📦 商品移動管理システム — メインアプリケーション

自店舗から他店舗への商品移動を記録・管理するWebアプリ。
Streamlit + Supabase で構築。iPad対応、バーコードリーダー対応。

起動コマンド:
    streamlit run inventory_app.py
"""

import streamlit as st
import pandas as pd
from datetime import datetime, date, timedelta

# --- ページ設定（必ず最初に呼ぶ） ---
st.set_page_config(
    page_title="📦 商品移動管理",
    page_icon="📦",
    layout="centered",
    initial_sidebar_state="expanded",
)

from inventory.config import APP_TITLE, PAGES, PAGE_TRANSFER, PAGE_HISTORY, PAGE_PRODUCTS
from inventory.ui_components import (
    apply_custom_css, show_product_card, show_transfer_item, show_stat_cards
)
from inventory import db


# ============================================
# カスタムCSS適用
# ============================================
apply_custom_css()


# ============================================
# 簡易パスワード認証
# ============================================
def check_password():
    """
    簡易パスワード認証。
    パスワードは .streamlit/secrets.toml の [passwords] セクションに設定。
    設定しない場合は認証なしで動作する（開発用）。
    """
    # secrets にパスワードが設定されていない場合はスキップ
    if "app_password" not in st.secrets:
        return True

    if "password_correct" not in st.session_state:
        st.session_state.password_correct = False

    if st.session_state.password_correct:
        return True

    # ログイン画面
    st.markdown("""
    <div style="text-align: center; padding: 2rem 0;">
        <h1>📦 商品移動管理システム</h1>
        <p style="color: #888; font-size: 1.1rem;">ログインしてください</p>
    </div>
    """, unsafe_allow_html=True)

    with st.form("login_form"):
        password = st.text_input("パスワード", type="password", placeholder="パスワードを入力")
        submitted = st.form_submit_button("🔑 ログイン", use_container_width=True)

        if submitted:
            if password == st.secrets["app_password"]:
                st.session_state.password_correct = True
                st.rerun()
            else:
                st.error("パスワードが正しくありません")

    return False


# 認証チェック
if not check_password():
    st.stop()


# ============================================
# セッション状態の初期化
# ============================================
def init_session_state():
    """セッション状態を初期化"""
    if "stores" not in st.session_state:
        st.session_state.stores = []

    if "current_store_id" not in st.session_state:
        st.session_state.current_store_id = None

    if "transfer_list" not in st.session_state:
        st.session_state.transfer_list = []  # 今回の移動リスト

    if "last_scanned_product" not in st.session_state:
        st.session_state.last_scanned_product = None

    if "jan_input_key" not in st.session_state:
        st.session_state.jan_input_key = 0


init_session_state()


# ============================================
# 店舗データの読み込み
# ============================================
@st.cache_data(ttl=300)
def load_stores():
    """店舗一覧をキャッシュ付きで読み込み"""
    return db.get_stores()


def refresh_stores():
    """店舗一覧を再読み込み"""
    load_stores.clear()
    st.session_state.stores = load_stores()


# 初回読み込み
if not st.session_state.stores:
    st.session_state.stores = load_stores()


# ============================================
# サイドバー
# ============================================
with st.sidebar:
    st.markdown(f"## {APP_TITLE}")
    st.divider()

    # --- 自分の店舗選択 ---
    st.markdown("### 🏪 自分の店舗")
    stores = st.session_state.stores
    store_names = [s["name"] for s in stores]

    if store_names:
        # 前回の選択を復元
        default_idx = 0
        if st.session_state.current_store_id:
            for i, s in enumerate(stores):
                if s["id"] == st.session_state.current_store_id:
                    default_idx = i
                    break

        selected_store_name = st.selectbox(
            "店舗を選択",
            store_names,
            index=default_idx,
            key="store_selector",
            label_visibility="collapsed"
        )

        # 選択した店舗のIDを保存
        selected_store = next(
            (s for s in stores if s["name"] == selected_store_name), None
        )
        if selected_store:
            st.session_state.current_store_id = selected_store["id"]
    else:
        st.warning("店舗が登録されていません")

    st.divider()

    # --- ナビゲーション ---
    st.markdown("### 📑 メニュー")
    page = st.radio(
        "ページ選択",
        PAGES,
        key="page_nav",
        label_visibility="collapsed"
    )

    st.divider()

    # --- 店舗管理（折りたたみ） ---
    with st.expander("⚙️ 店舗の追加"):
        new_store_name = st.text_input("新しい店舗名", key="new_store_name")
        if st.button("追加", key="add_store_btn", use_container_width=True):
            if new_store_name.strip():
                if db.add_store(new_store_name.strip()):
                    st.success(f"「{new_store_name}」を追加しました")
                    refresh_stores()
                    st.rerun()
            else:
                st.warning("店舗名を入力してください")

    with st.expander("🗑️ 店舗の削除"):
        if store_names:
            del_store_name = st.selectbox(
                "削除する店舗",
                store_names,
                key="del_store_select",
                label_visibility="collapsed"
            )
            del_store = next(
                (s for s in stores if s["name"] == del_store_name), None
            )

            # 確認チェックボックス
            confirm = st.checkbox(
                f"「{del_store_name}」を本当に削除しますか？",
                key="del_confirm"
            )

            if confirm:
                st.warning("⚠️ 削除すると元に戻せません")
                if st.button(
                    f"🗑️ 「{del_store_name}」を削除",
                    key="del_store_btn",
                    use_container_width=True,
                    type="primary"
                ):
                    if del_store:
                        if db.delete_store(del_store["id"]):
                            st.success(f"「{del_store_name}」を削除しました")
                            refresh_stores()
                            st.rerun()
        else:
            st.info("店舗がありません")


# ============================================
# メインコンテンツ
# ============================================

# --- 移動入力画面 ---
if page == PAGE_TRANSFER:
    st.markdown("## ➡️ 移動入力")

    if not st.session_state.current_store_id:
        st.warning("サイドバーで自分の店舗を選択してください")
        st.stop()

    # 移動元の表示
    from_store = next(
        (s for s in stores if s["id"] == st.session_state.current_store_id),
        None
    )
    if from_store:
        st.info(f"📍 移動元: **{from_store['name']}**")

    # 移動先の選択
    to_store_names = [s["name"] for s in stores if s["id"] != st.session_state.current_store_id]
    if not to_store_names:
        st.warning("移動先店舗がありません")
        st.stop()

    to_store_name = st.selectbox("📍 移動先店舗", to_store_names, key="to_store_select")
    to_store = next((s for s in stores if s["name"] == to_store_name), None)

    st.divider()

    # --- バーコード（JAN）入力 ---
    st.markdown("### 🔍 商品スキャン")

    # バーコードリーダー入力欄
    jan_code = st.text_input(
        "JANコード",
        placeholder="バーコードをスキャンまたは手入力",
        key=f"jan_input_{st.session_state.jan_input_key}",
        label_visibility="collapsed"
    )

    # 数量入力
    quantity = st.number_input("数量", min_value=1, value=1, step=1, key="quantity_input")

    # JAN入力時の処理
    if jan_code:
        jan_code = jan_code.strip()
        product = db.search_product_by_jan(jan_code)

        if product:
            show_product_card(product)
            st.session_state.last_scanned_product = product

            # 追加ボタン
            if st.button("✅ 移動リストに追加", use_container_width=True, type="primary"):
                item = {
                    "jan_code": product["jan_code"],
                    "product_name": product["product_name"],
                    "cost_price": product["cost_price"],
                    "selling_price": product["selling_price"],
                    "quantity": quantity,
                    "from_store_id": st.session_state.current_store_id,
                    "to_store_id": to_store["id"] if to_store else None,
                }
                st.session_state.transfer_list.append(item)
                st.session_state.last_scanned_product = None
                st.session_state.jan_input_key += 1
                st.rerun()
        else:
            # 未登録商品 — 手入力で追加できるフォーム
            st.warning(f"⚠️ JANコード **{jan_code}** は未登録です。手入力で追加できます。")
            with st.form(f"unregistered_form_{jan_code}"):
                unreg_name = st.text_input("商品名", placeholder="商品名を入力してください")
                col_uc, col_us = st.columns(2)
                with col_uc:
                    unreg_cost = st.number_input("原価", min_value=0, value=0, step=1, key="unreg_cost")
                with col_us:
                    unreg_sell = st.number_input("売価", min_value=0, value=0, step=1, key="unreg_sell")
                unreg_submit = st.form_submit_button("✅ この内容で移動リストに追加", use_container_width=True, type="primary")
                if unreg_submit:
                    if unreg_name:
                        item = {
                            "jan_code": jan_code,
                            "product_name": unreg_name.strip(),
                            "cost_price": unreg_cost,
                            "selling_price": unreg_sell,
                            "quantity": quantity,
                            "from_store_id": st.session_state.current_store_id,
                            "to_store_id": to_store["id"] if to_store else None,
                        }
                        st.session_state.transfer_list.append(item)
                        st.session_state.jan_input_key += 1
                        st.rerun()
                    else:
                        st.warning("商品名を入力してください")

    st.divider()

    # --- 今回の移動リスト ---
    st.markdown(f"### 📋 今回の移動リスト（{len(st.session_state.transfer_list)}件）")

    if st.session_state.transfer_list:
        # 合計計算
        total_cost = sum(
            item["cost_price"] * item["quantity"]
            for item in st.session_state.transfer_list
        )
        total_items = sum(item["quantity"] for item in st.session_state.transfer_list)

        show_stat_cards({
            "商品種類": f"{len(st.session_state.transfer_list)}種",
            "合計数量": f"{total_items}個",
            "原価合計": f"¥{total_cost:,}",
        })

        st.markdown("")

        # 各商品の表示（数量変更可能）
        for i, item in enumerate(st.session_state.transfer_list):
            col1, col2, col3 = st.columns([4, 2, 1])
            with col1:
                show_transfer_item(item, i)
            with col2:
                new_qty = st.number_input(
                    "数量",
                    min_value=1,
                    value=item["quantity"],
                    step=1,
                    key=f"qty_{i}",
                    label_visibility="collapsed"
                )
                if new_qty != item["quantity"]:
                    st.session_state.transfer_list[i]["quantity"] = new_qty
                    st.rerun()
            with col3:
                if st.button("🗑️", key=f"remove_{i}"):
                    st.session_state.transfer_list.pop(i)
                    st.rerun()

        st.markdown("")

        # --- 登録ボタン ---
        # 合計を再計算（数量変更後）
        total_cost = sum(
            item["cost_price"] * item["quantity"]
            for item in st.session_state.transfer_list
        )
        total_items = sum(item["quantity"] for item in st.session_state.transfer_list)

        col_reg, col_clear = st.columns([3, 1])
        with col_reg:
            st.markdown('<div class="big-button">', unsafe_allow_html=True)
            if st.button(
                f"📦 移動を登録する（{total_items}個）",
                use_container_width=True,
                type="primary",
                key="register_btn"
            ):
                if to_store:
                    success = db.add_transfers_batch(st.session_state.transfer_list)
                    if success:
                        st.success(f"✅ {len(st.session_state.transfer_list)}件の移動を登録しました！")
                        st.session_state.transfer_list = []
                        st.balloons()
                        st.rerun()
                else:
                    st.error("移動先店舗を選択してください")
            st.markdown('</div>', unsafe_allow_html=True)

        with col_clear:
            st.markdown("<br>", unsafe_allow_html=True)
            if st.button("🗑️ 全消去", key="clear_all"):
                st.session_state.transfer_list = []
                st.rerun()
    else:
        st.markdown(
            '<p style="text-align:center; color:#aaa; padding:2rem;">上のJAN入力欄から商品をスキャンして追加してください</p>',
            unsafe_allow_html=True
        )


# --- 移動履歴画面 ---
elif page == PAGE_HISTORY:
    st.markdown("## 📋 移動履歴")

    # フィルター
    col1, col2 = st.columns(2)
    with col1:
        date_from = st.date_input(
            "開始日",
            value=date.today() - timedelta(days=30),
            key="hist_date_from"
        )
    with col2:
        date_to = st.date_input(
            "終了日",
            value=date.today(),
            key="hist_date_to"
        )

    col3, col4 = st.columns(2)
    with col3:
        filter_store_options = ["全店舗"] + [s["name"] for s in stores]
        filter_from = st.selectbox("移動元", filter_store_options, key="hist_from")
    with col4:
        filter_to = st.selectbox("移動先", filter_store_options, key="hist_to")

    # 検索パラメータ
    from_id = None
    to_id = None
    if filter_from != "全店舗":
        from_id = next((s["id"] for s in stores if s["name"] == filter_from), None)
    if filter_to != "全店舗":
        to_id = next((s["id"] for s in stores if s["name"] == filter_to), None)

    # データ取得
    transfers = db.get_transfers(
        from_store_id=from_id,
        to_store_id=to_id,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
    )

    if transfers:
        # 統計表示
        total_cost = sum(t.get("total_cost", 0) for t in transfers)
        total_qty = sum(t.get("quantity", 0) for t in transfers)

        show_stat_cards({
            "移動件数": f"{len(transfers)}件",
            "合計数量": f"{total_qty}個",
            "原価合計": f"¥{total_cost:,}",
        })

        st.markdown("")

        # テーブル表示用データ加工
        display_data = []
        for t in transfers:
            # 店舗名を結合データから取得
            from_name = t.get("from_store", {}).get("name", "-") if isinstance(t.get("from_store"), dict) else "-"
            to_name = t.get("to_store", {}).get("name", "-") if isinstance(t.get("to_store"), dict) else "-"

            # 日付のフォーマット
            transfer_date = t.get("transfer_date", "")
            if transfer_date:
                try:
                    dt = datetime.fromisoformat(transfer_date.replace("Z", "+00:00"))
                    transfer_date = dt.strftime("%Y/%m/%d %H:%M")
                except (ValueError, AttributeError):
                    pass

            display_data.append({
                "日付": transfer_date,
                "移動元": from_name,
                "移動先": to_name,
                "商品名": t.get("product_name", ""),
                "JAN": t.get("jan_code", ""),
                "数量": t.get("quantity", 0),
                "原価": t.get("cost_price", 0),
                "原価合計": t.get("total_cost", 0),
                "売価": t.get("selling_price", 0),
                "_id": t.get("id"),
            })

        df = pd.DataFrame(display_data)

        # テーブル表示（IDカラムは非表示）
        st.dataframe(
            df.drop(columns=["_id"]),
            use_container_width=True,
            hide_index=True,
        )

        # CSVエクスポート
        csv_data = df.drop(columns=["_id"]).to_csv(index=False, encoding="utf-8-sig")
        st.download_button(
            label="📥 CSVダウンロード",
            data=csv_data,
            file_name=f"移動履歴_{date_from}_{date_to}.csv",
            mime="text/csv",
            use_container_width=True,
        )
    else:
        st.info("📭 指定期間の移動履歴はありません")


# --- 商品マスタ管理画面 ---
elif page == PAGE_PRODUCTS:
    st.markdown("## 📦 商品マスタ管理")

    # 商品数表示
    product_count = db.get_product_count()
    show_stat_cards({"登録商品数": f"{product_count:,}件"})

    st.markdown("")

    # --- CSVアップロード ---
    st.markdown("### 📤 商品データの更新")
    st.markdown(
        "CSVファイルをアップロードすると、商品マスタを一括更新します。"
        "既存のJANコードは上書き、新しいJANコードは追加されます。"
    )

    uploaded_file = st.file_uploader(
        "CSVファイルを選択",
        type=["csv"],
        key="product_csv_upload",
        label_visibility="collapsed"
    )

    if uploaded_file:
        try:
            # CSVを読み込み（ヘッダーの有無を自動判定）
            df_preview = pd.read_csv(uploaded_file, encoding="utf-8", nrows=5)

            # ヘッダーがなさそうならheader=Noneで再読み込み
            first_cols = [str(c) for c in df_preview.columns]
            has_header = any(
                c in first_cols
                for c in ["JANコード", "JAN", "商品名", "jan_code", "product_name"]
            )

            uploaded_file.seek(0)
            if has_header:
                df = pd.read_csv(uploaded_file, encoding="utf-8")
            else:
                df = pd.read_csv(uploaded_file, encoding="utf-8", header=None)

            st.markdown(f"**読み込み件数: {len(df)}行**")
            st.dataframe(df.head(10), use_container_width=True, hide_index=True)

            if st.button("✅ この内容で更新する", type="primary", use_container_width=True):
                with st.spinner("更新中..."):
                    success, errors = db.upsert_products_from_csv(df)
                st.success(f"✅ {success}件を更新しました（エラー: {errors}件）")
                st.rerun()

        except Exception as e:
            st.error(f"CSVの読み込みに失敗しました: {e}")

    st.divider()

    # --- 手動で商品登録 ---
    st.markdown("### ✏️ 商品を手動で登録")
    with st.form("add_product_form", clear_on_submit=True):
        col_j, col_n = st.columns([1, 2])
        with col_j:
            new_jan = st.text_input("JANコード *", placeholder="バーコードをスキャン")
        with col_n:
            new_name = st.text_input("商品名 *", placeholder="商品名を入力")

        col_c, col_s, col_cat = st.columns(3)
        with col_c:
            new_cost = st.number_input("原価", min_value=0, value=0, step=1)
        with col_s:
            new_sell = st.number_input("売価", min_value=0, value=0, step=1)
        with col_cat:
            new_cat = st.text_input("商品区分", placeholder="任意")

        submitted = st.form_submit_button("✅ 登録する", use_container_width=True, type="primary")
        if submitted:
            if new_jan and new_name:
                markup = round(new_cost / new_sell, 4) if new_sell > 0 else 0
                product_data = {
                    "jan_code": new_jan.strip(),
                    "product_name": new_name.strip(),
                    "cost_price": new_cost,
                    "selling_price": new_sell,
                    "category": new_cat.strip(),
                    "markup_rate": markup,
                }
                if db.add_or_update_product(product_data):
                    st.success(f"✅ 「{new_name}」を登録しました（JAN: {new_jan}）")
                    st.rerun()
            else:
                st.warning("JANコードと商品名は必須です")

    st.divider()

    # --- 商品検索 ---
    st.markdown("### 🔍 商品検索・削除")
    search_jan = st.text_input(
        "JANコードで検索",
        placeholder="JANコードを入力またはスキャン",
        key="product_search_jan"
    )

    if search_jan:
        product = db.search_product_by_jan(search_jan.strip())
        if product:
            show_product_card(product)
            st.markdown(f"""
            | 項目 | 値 |
            |------|------|
            | JANコード | `{product.get('jan_code', '-')}` |
            | 商品名 | {product.get('product_name', '-')} |
            | 原価 | ¥{product.get('cost_price', 0):,} |
            | 売価 | ¥{product.get('selling_price', 0):,} |
            | 商品区分 | {product.get('category', '-')} |
            | かけ率 | {product.get('markup_rate', 0):.2f} |
            """)

            # 削除機能（確認付き）
            del_confirm = st.checkbox(
                f"この商品を削除する",
                key="del_product_confirm"
            )
            if del_confirm:
                st.warning("⚠️ 削除すると元に戻せません")
                if st.button(
                    f"🗑️ 「{product.get('product_name', '')}」を削除",
                    key="del_product_btn",
                    type="primary",
                    use_container_width=True,
                ):
                    if db.delete_product(product["jan_code"]):
                        st.success("✅ 削除しました")
                        st.rerun()
        else:
            st.warning(f"JANコード **{search_jan}** の商品は登録されていません")

    st.divider()

    # --- 商品一覧（一部表示） ---
    st.markdown("### 📋 登録済み商品一覧（最新100件）")
    products = db.get_all_products(limit=100)

    if products:
        df_products = pd.DataFrame(products)

        # 表示用カラム選択
        display_cols = {
            "jan_code": "JANコード",
            "product_name": "商品名",
            "cost_price": "原価",
            "selling_price": "売価",
            "category": "区分",
        }

        available_cols = [c for c in display_cols.keys() if c in df_products.columns]
        df_display = df_products[available_cols].rename(columns=display_cols)

        st.dataframe(df_display, use_container_width=True, hide_index=True)
    else:
        st.info("商品が登録されていません。CSVファイルをアップロードしてください。")
