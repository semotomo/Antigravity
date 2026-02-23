# シフト作成ツール — メインUI
# Streamlit製のシフト自動作成ツール

import streamlit as st
import pandas as pd
import datetime
import json
import io

# --- 自作モジュール ---
from utils import is_holiday, highlight_cells, get_default_date_range
from data_io import (
    load_settings_from_file, get_default_data, save_settings_to_file,
    generate_custom_csv, SETTINGS_FILE
)
from solver import solve_schedule_from_ui

# =============================================
# ページ設定
# =============================================
st.set_page_config(page_title="シフト作成ツール", page_icon="📅", layout="wide")

# --- CSS注入（レスポンシブ対応 + UI改善） ---
st.markdown("""
<style>
/* === ベースフォント === */
html, body, [class*="css"] {
    font-family: 'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif;
}

/* === 名前列の幅を短縮 === */
div[data-testid="stDataEditor"] table td:first-child,
div[data-testid="stDataEditor"] table th:first-child {
    min-width: 60px !important;
    max-width: 100px !important;
}

/* === テーブル全体の見やすさ === */
div[data-testid="stTable"] table {
    font-size: 13px;
    border-collapse: collapse;
}
div[data-testid="stTable"] table th {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 6px 8px !important;
    position: sticky;
    top: 0;
    z-index: 10;
}
div[data-testid="stTable"] table td {
    padding: 4px 6px !important;
    text-align: center;
    border: 1px solid #e0e0e0;
}

/* === ヘッダーのスタイル === */
h1 {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-weight: 800;
}

/* === サイドバーの改善 === */
[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%);
}
[data-testid="stSidebar"] .stButton > button {
    width: 100%;
    margin-bottom: 4px;
    border-radius: 8px;
    font-weight: 600;
}

/* === ボタンの改善 === */
.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 10px;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 700;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}
.stButton > button[kind="primary"]:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

/* === メトリクスカード === */
div[data-testid="stMetric"] {
    background: white;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    border: 1px solid #e9ecef;
}

/* === expander の改善 === */
details[data-testid="stExpander"] {
    border-radius: 10px;
    border: 1px solid #e0e0e0;
    background: #fafafa;
}

/* === レスポンシブ対応 === */
@media (max-width: 768px) {
    div[data-testid="stTable"] table {
        font-size: 10px;
    }
    div[data-testid="stTable"] table td,
    div[data-testid="stTable"] table th {
        padding: 2px 3px !important;
    }
    .block-container {
        padding: 1rem 0.5rem !important;
    }
}

/* === 成功/エラーメッセージ === */
div[data-testid="stAlert"] {
    border-radius: 10px;
    font-weight: 500;
}

/* === フォームの角丸 === */
[data-testid="stForm"] {
    border-radius: 12px;
    border: 1px solid #e0e0e0;
    padding: 20px;
    background: #fafbfc;
}
</style>
""", unsafe_allow_html=True)


# =============================================
# 初期化
# =============================================
def initialize_session():
    """セッション状態の初期化"""
    if 'initialized' not in st.session_state:
        loaded_staff, loaded_hol, loaded_start, loaded_end = load_settings_from_file()
        if loaded_staff is not None:
            st.session_state.staff_df = loaded_staff
            st.session_state.holidays_df = loaded_hol
            if loaded_start and loaded_end:
                st.session_state.start_date = loaded_start
                st.session_state.end_date = loaded_end
            else:
                st.session_state.start_date, st.session_state.end_date = get_default_date_range()
        else:
            staff_df, holidays_df = get_default_data()
            st.session_state.staff_df = staff_df
            st.session_state.holidays_df = holidays_df
            st.session_state.start_date, st.session_state.end_date = get_default_date_range()
        st.session_state.initialized = True
        st.session_state.show_help = True  # 初回ヘルプ表示フラグ

initialize_session()


# =============================================
# ヘッダー
# =============================================
st.title("📅 シフト作成ツール")
st.caption("スタッフの勤務条件と休暇希望から、最適なシフトを自動で作成します")


# =============================================
# 初回ヘルプガイド
# =============================================
if st.session_state.get('show_help', False):
    with st.expander("🔰 **はじめに — 使い方ガイド**", expanded=True):
        cols = st.columns(3)
        with cols[0]:
            st.markdown("""
            ### ①スタッフ登録
            1. サイドバーで日付範囲を設定
            2. 「スタッフ設定」にスタッフ情報を入力
            3. 各スタッフの役割（A/B/C/ネコ）をチェック
            """)
        with cols[1]:
            st.markdown("""
            ### ②希望休の入力
            1. 「希望休入力」でチェックボックスを使用
            2. 休みたい日にチェックを入れる
            3. 入力完了後「保存」を押す
            """)
        with cols[2]:
            st.markdown("""
            ### ③シフト作成
            1. 「🚀 シフトを作成する」ボタンを押す
            2. 自動でシフトが計算される
            3. 結果をCSVでダウンロード可能
            """)
        st.markdown("---")
        col_help_1, col_help_2 = st.columns(2)
        with col_help_1:
            st.markdown("""
            **💡 役割の説明**
            | 記号 | 意味 |
            |------|------|
            | A | 朝番メイン |
            | B | 日勤メイン |
            | C | 遅番メイン |
            | ネコ | ネコ番 |
            | 〇 | 通常勤務 |
            | ／ | 公休 |
            | × | 希望休 |
            """)
        with col_help_2:
            st.markdown("""
            **📊 シフト表の色**
            | 色 | 意味 |
            |----|------|
            | 🟦 水色 | A（朝番） |
            | 🟩 緑 | B（日勤） |
            | 🟨 黄色 | C（遅番） |
            | 🟧 オレンジ | ネコ番 |
            | 🟪 ラベンダー | 通常勤務 |
            | 🟥 赤背景+白字 | 人員不足 |
            """)
        if st.button("✅ ガイドを閉じる"):
            st.session_state.show_help = False
            st.rerun()


# =============================================
# サイドバー
# =============================================
with st.sidebar:
    st.header("⚙️ 設定")

    # --- 保存・読み込み ---
    st.subheader("💾 データ管理")
    col_s1, col_s2 = st.columns(2)
    with col_s1:
        if st.button("📥 保存", use_container_width=True):
            try:
                save_settings_to_file(
                    st.session_state.staff_df,
                    st.session_state.holidays_df,
                    st.session_state.start_date,
                    st.session_state.end_date
                )
                st.success("保存しました！")
            except Exception as e:
                st.error(f"保存エラー: {e}")
    with col_s2:
        if st.button("📤 読込", use_container_width=True):
            loaded_staff, loaded_hol, loaded_start, loaded_end = load_settings_from_file()
            if loaded_staff is not None:
                st.session_state.staff_df = loaded_staff
                st.session_state.holidays_df = loaded_hol
                if loaded_start and loaded_end:
                    st.session_state.start_date = loaded_start
                    st.session_state.end_date = loaded_end
                st.success("読み込みました！")
                st.rerun()
            else:
                st.warning("保存データが見つかりません")

    st.divider()

    # --- 日付範囲 ---
    st.subheader("📆 シフト期間")
    st.session_state.start_date = st.date_input(
        "開始日", value=st.session_state.start_date
    )
    st.session_state.end_date = st.date_input(
        "終了日", value=st.session_state.end_date
    )

    # バリデーション
    if st.session_state.start_date >= st.session_state.end_date:
        st.error("⚠️ 開始日は終了日より前にしてください")

    st.divider()

    # --- バックアップ ---
    st.subheader("📋 バックアップ")
    backup_data = {
        "staff": st.session_state.staff_df.to_dict(),
        "holidays": st.session_state.holidays_df.to_dict(),
        "date_range": {
            "start": st.session_state.start_date.strftime("%Y-%m-%d"),
            "end": st.session_state.end_date.strftime("%Y-%m-%d")
        }
    }
    st.download_button(
        "⬇️ 設定をダウンロード",
        data=json.dumps(backup_data, ensure_ascii=False, indent=2),
        file_name="shift_backup.json",
        mime="application/json",
        use_container_width=True
    )

    uploaded_file = st.file_uploader("⬆️ 設定をアップロード", type=["json"])
    if uploaded_file is not None:
        try:
            uploaded_data = json.load(uploaded_file)
            st.session_state.staff_df = pd.DataFrame(uploaded_data["staff"])
            st.session_state.holidays_df = pd.DataFrame(uploaded_data["holidays"])
            if "date_range" in uploaded_data:
                st.session_state.start_date = datetime.datetime.strptime(
                    uploaded_data["date_range"]["start"], "%Y-%m-%d"
                ).date()
                st.session_state.end_date = datetime.datetime.strptime(
                    uploaded_data["date_range"]["end"], "%Y-%m-%d"
                ).date()
            st.success("アップロードしました！")
            st.rerun()
        except Exception as e:
            st.error(f"アップロードエラー: {e}")

    st.divider()

    # --- ヘルプ再表示 ---
    if st.button("🔰 使い方ガイドを表示", use_container_width=True):
        st.session_state.show_help = True
        st.rerun()


# =============================================
# メインコンテンツ
# =============================================

# --- 日付リスト生成 ---
days_list = []
d = st.session_state.start_date
while d <= st.session_state.end_date:
    days_list.append(d)
    d += datetime.timedelta(days=1)
num_days = len(days_list)

if num_days == 0:
    st.error("⚠️ 日付範囲が不正です。サイドバーで設定し直してください。")
    st.stop()

weekdays_jp = ["月", "火", "水", "木", "金", "土", "日"]


# =============================================
# 基本設定
# =============================================
with st.expander("📊 **基本設定** — 人数・曜日別目標", expanded=False):
    col_c1, col_c2 = st.columns(2)
    with col_c1:
        min_morning = st.number_input("朝の最低人数", 1, 10, 3, key="min_morning")
        min_night = st.number_input("夜の最低人数", 1, 10, 3, key="min_night")
    with col_c2:
        priority_days = st.multiselect(
            "優先曜日（人員を多めに配置）",
            ["月", "火", "水", "木", "金", "土", "日"],
            default=[]
        )

    st.markdown("##### 曜日別の目標人数")
    st.caption("最低人数は必ず守られます。目標人数は「できるだけ」満たす数です。")
    target_cols = st.columns(7)
    weekday_targets = {}
    for i, wd in enumerate(["月", "火", "水", "木", "金", "土", "日"]):
        with target_cols[i]:
            st.markdown(f"**{wd}**")
            t_m = st.number_input(f"朝_{wd}", 1, 10, min_morning, key=f"target_m_{wd}", label_visibility="collapsed")
            t_n = st.number_input(f"夜_{wd}", 1, 10, min_night, key=f"target_n_{wd}", label_visibility="collapsed")
            weekday_targets[wd] = {'朝目標': t_m, '夜目標': t_n}


# =============================================
# スタッフ設定
# =============================================
with st.expander("👥 **スタッフ設定**", expanded=True):
    st.caption("スタッフの情報を入力してください。行を追加・削除できます。")

    # バリデーション：名前の重複チェック
    names = st.session_state.staff_df['名前'].dropna().tolist()
    duplicates = [n for n in set(names) if names.count(n) > 1 and n != '']
    if duplicates:
        st.warning(f"⚠️ 名前が重複しています: {', '.join(duplicates)}")

    edited_staff = st.data_editor(
        st.session_state.staff_df,
        use_container_width=True,
        num_rows="dynamic",
        key="staff_editor"
    )
    st.session_state.staff_df = edited_staff

    # スタッフ人数チェック
    valid_staff = edited_staff.dropna(subset=['名前'])
    valid_staff = valid_staff[valid_staff['名前'] != '']
    if len(valid_staff) < 4:
        st.warning("⚠️ シフトを作成するには最低4人のスタッフが必要です")


# =============================================
# 希望休入力
# =============================================
with st.expander("🏖️ **希望休入力**", expanded=True):
    st.caption("休みたい日にチェックを入れてください。")

    # holidays_dfの列数を日数に合わせる
    needed_cols = [f"Day_{i+1}" for i in range(num_days)]
    current_cols = list(st.session_state.holidays_df.columns)

    if needed_cols != current_cols:
        new_h = pd.DataFrame(False, index=range(len(st.session_state.staff_df)), columns=needed_cols)
        for c in needed_cols:
            if c in st.session_state.holidays_df.columns:
                for j in range(min(len(new_h), len(st.session_state.holidays_df))):
                    new_h.at[j, c] = st.session_state.holidays_df.at[j, c] if j in st.session_state.holidays_df.index else False
        st.session_state.holidays_df = new_h

    # 行数をスタッフ数に合わせる
    if len(st.session_state.holidays_df) != len(st.session_state.staff_df):
        new_h = pd.DataFrame(
            False,
            index=range(len(st.session_state.staff_df)),
            columns=needed_cols
        )
        for j in range(min(len(new_h), len(st.session_state.holidays_df))):
            for c in needed_cols:
                if c in st.session_state.holidays_df.columns and j in st.session_state.holidays_df.index:
                    new_h.at[j, c] = st.session_state.holidays_df.at[j, c]
        st.session_state.holidays_df = new_h

    # カラム名を日付表示にマッピング
    display_cols = {}
    for i, d in enumerate(days_list):
        wd = weekdays_jp[d.weekday()]
        hol = "祝" if is_holiday(d) else ""
        display_cols[f"Day_{i+1}"] = f"{d.day}({wd}){hol}"

    h_display_df = st.session_state.holidays_df.copy()
    h_display_df.index = [
        st.session_state.staff_df.at[j, '名前']
        if j < len(st.session_state.staff_df) else f"Staff_{j}"
        for j in range(len(h_display_df))
    ]
    h_display_df = h_display_df.rename(columns=display_cols)

    edited_h = st.data_editor(
        h_display_df,
        use_container_width=True,
        key="holidays_editor"
    )

    # 編集結果を反映
    reverse_cols = {v: k for k, v in display_cols.items()}
    edited_h_df = edited_h.rename(columns=reverse_cols)
    edited_h_df.index = st.session_state.staff_df.index[:len(edited_h_df)]
    edited_h_df.columns = st.session_state.holidays_df.columns[:len(edited_h_df.columns)]
    st.session_state.holidays_df = edited_h_df


# =============================================
# シフト作成
# =============================================
st.markdown("---")
st.subheader("🚀 シフト作成")

col_btn_1, col_btn_2 = st.columns([3, 1])
with col_btn_1:
    create_btn = st.button(
        "🚀 シフトを作成する",
        type="primary",
        use_container_width=True
    )
with col_btn_2:
    st.caption(f"期間: {num_days}日間\nスタッフ: {len(valid_staff) if 'valid_staff' in dir() else '?'}人")

if create_btn:
    # --- バリデーション ---
    staff_check = st.session_state.staff_df.dropna(subset=['名前'])
    staff_check = staff_check[staff_check['名前'] != '']

    if len(staff_check) < 4:
        st.error("❌ スタッフが4人未満です。スタッフを追加してください。")
    elif st.session_state.start_date >= st.session_state.end_date:
        st.error("❌ 日付範囲が不正です。サイドバーで設定し直してください。")
    else:
        constraints = {
            'min_morning': min_morning,
            'min_night': min_night,
            'weekday_targets': weekday_targets
        }

        with st.spinner("🔄 シフトを計算中... しばらくお待ちください"):
            try:
                result_df = solve_schedule_from_ui(
                    st.session_state.staff_df,
                    st.session_state.holidays_df,
                    days_list,
                    constraints,
                    priority_days
                )

                if result_df is not None:
                    st.success("✅ シフトが完成しました！")

                    # --- サマリー表示 ---
                    with st.expander("📈 **シフトサマリー**", expanded=True):
                        s_cols = st.columns(4)
                        # 不足日カウント
                        shortage_count = 0
                        for col in result_df.columns:
                            if col[0] != '勤(休)':
                                if '※' in result_df[col].values:
                                    shortage_count += 1
                        with s_cols[0]:
                            st.metric("期間", f"{num_days}日")
                        with s_cols[1]:
                            st.metric("スタッフ数", f"{len(staff_check)}人")
                        with s_cols[2]:
                            st.metric("人員不足日", f"{shortage_count}日",
                                     delta=f"{'🟢 なし' if shortage_count == 0 else '🔴 要確認'}")
                        with s_cols[3]:
                            fill_rate = ((num_days - shortage_count) / num_days * 100) if num_days > 0 else 0
                            st.metric("充足率", f"{fill_rate:.0f}%")

                    # --- シフト表表示 ---
                    styled = result_df.style.apply(highlight_cells, axis=None)
                    st.dataframe(styled, use_container_width=True, height=400)

                    # --- CSVダウンロード ---
                    csv_data = generate_custom_csv(
                        result_df, st.session_state.staff_df, days_list
                    )
                    col_dl_1, col_dl_2 = st.columns(2)
                    with col_dl_1:
                        st.download_button(
                            "📄 CSVをダウンロード（Excel対応）",
                            data=csv_data,
                            file_name=f"shift_{st.session_state.start_date}_{st.session_state.end_date}.csv",
                            mime="text/csv",
                            use_container_width=True
                        )
                else:
                    st.error("❌ シフトを生成できませんでした。スタッフ情報を確認してください。")
            except Exception as e:
                st.error(f"❌ エラーが発生しました: {e}")
                with st.expander("🔍 エラー詳細"):
                    st.code(str(e))


# =============================================
# フッター
# =============================================
st.markdown("---")
st.markdown(
    "<div style='text-align: center; color: #888; font-size: 12px;'>"
    "📅 シフト作成ツール v2.0 | Powered by Streamlit"
    "</div>",
    unsafe_allow_html=True
)