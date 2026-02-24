# シフト作成ツール — メインUI
# Streamlit製のシフト自動作成ツール
# やわらかいピーチ/コーラル系デザイン

import streamlit as st
import pandas as pd
import datetime
import json
import io

# --- 自作モジュール ---
from utils import is_holiday, highlight_cells, get_default_date_range, DEFAULT_ROLES_CONFIG
from data_io import (
    load_settings_from_file, get_default_data, save_settings_to_file,
    generate_custom_csv, SETTINGS_FILE,
    save_shift_history, load_shift_history_list, load_shift_history_detail,
    delete_shift_history, load_roles_config, save_roles_config
)
from solver import solve_schedule_from_ui

# =============================================
# ページ設定
# =============================================
st.set_page_config(page_title="シフト作成ツール", page_icon="📅", layout="wide")

# --- CSS注入（やわらかいピーチ/コーラル系デザイン） ---
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
    background: linear-gradient(135deg, #f5a08c 0%, #e8927c 100%);
    color: white;
    padding: 6px 8px !important;
    position: sticky;
    top: 0;
    z-index: 10;
    border-radius: 4px;
}
div[data-testid="stTable"] table td {
    padding: 4px 6px !important;
    text-align: center;
    border: 1px solid #f0e0db;
}

/* === ヘッダーのスタイル === */
h1 {
    background: linear-gradient(135deg, #e8927c 0%, #f5a08c 50%, #f5c6b8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-weight: 800;
}

/* === サイドバーの改善 === */
[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #fff5f0 0%, #fce8e0 100%);
}
[data-testid="stSidebar"] .stButton > button {
    width: 100%;
    margin-bottom: 4px;
    border-radius: 12px;
    font-weight: 600;
    border: 1px solid #f0d0c0;
    background: white;
    color: #5a3e3e;
    transition: all 0.3s ease;
}
[data-testid="stSidebar"] .stButton > button:hover {
    background: #fff0eb;
    border-color: #e8927c;
    transform: translateY(-1px);
}

/* === ボタンの改善 === */
.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, #e8927c 0%, #f5a08c 100%);
    color: white;
    border: none;
    border-radius: 14px;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 700;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(232, 146, 124, 0.3);
}
.stButton > button[kind="primary"]:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(232, 146, 124, 0.5);
}

/* === メトリクスカード === */
div[data-testid="stMetric"] {
    background: white;
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 2px 12px rgba(232, 146, 124, 0.1);
    border: 1px solid #f5e0d8;
}

/* === expander の改善 === */
details[data-testid="stExpander"] {
    border-radius: 14px;
    border: 1px solid #f0d8d0;
    background: #fffaf8;
}
details[data-testid="stExpander"] summary {
    border-radius: 14px;
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
    border-radius: 12px;
    font-weight: 500;
}

/* === フォームの角丸 === */
[data-testid="stForm"] {
    border-radius: 16px;
    border: 1px solid #f0d8d0;
    padding: 20px;
    background: #fffcfa;
}

/* === タブのスタイル === */
.stTabs [data-baseweb="tab-list"] {
    gap: 8px;
}
.stTabs [data-baseweb="tab"] {
    border-radius: 10px 10px 0 0;
    padding: 8px 16px;
    font-weight: 600;
}

/* === カスタムカードスタイル === */
.help-card {
    background: white;
    border-radius: 16px;
    padding: 24px;
    border: 1px solid #f5e0d8;
    box-shadow: 0 2px 8px rgba(232, 146, 124, 0.08);
    text-align: center;
    margin-bottom: 8px;
}
.help-card-icon {
    font-size: 42px;
    margin-bottom: 8px;
}
.help-card h3 {
    color: #e8927c;
    font-size: 16px;
    margin-bottom: 12px;
}

/* === セクション見出し === */
.section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}

/* === コンフリクト警告ハイライト === */
.conflict-warning {
    background: #fff3e0;
    border: 1px solid #ffb74d;
    border-radius: 12px;
    padding: 12px 16px;
    margin: 8px 0;
}
</style>
""", unsafe_allow_html=True)


# =============================================
# 初期化
# =============================================
def initialize_session():
    """セッション状態の初期化"""
    if 'initialized' not in st.session_state:
        result = load_settings_from_file()
        if result[0] is not None:
            loaded_staff, loaded_hol, loaded_req, loaded_memos, loaded_start, loaded_end, loaded_roles = result
            st.session_state.staff_df = loaded_staff
            st.session_state.holidays_df = loaded_hol
            st.session_state.required_work_df = loaded_req
            st.session_state.memos = loaded_memos if loaded_memos else {}
            st.session_state.roles_config = loaded_roles if loaded_roles else [dict(r) for r in DEFAULT_ROLES_CONFIG]
            if loaded_start and loaded_end:
                st.session_state.start_date = loaded_start
                st.session_state.end_date = loaded_end
            else:
                st.session_state.start_date, st.session_state.end_date = get_default_date_range()
        else:
            st.session_state.roles_config = [dict(r) for r in DEFAULT_ROLES_CONFIG]
            staff_df, holidays_df, required_work_df = get_default_data(st.session_state.roles_config)
            st.session_state.staff_df = staff_df
            st.session_state.holidays_df = holidays_df
            st.session_state.required_work_df = required_work_df
            st.session_state.memos = {}
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
            <div class="help-card">
                <div class="help-card-icon">🐾</div>
                <p style="color: #b0b0b0; font-size: 12px; margin-bottom: 4px;">STEP 01</p>
                <h3>スタッフ登録</h3>
                <div style="text-align: left; font-size: 13px; color: #555;">
                    • サイドバーで日付範囲を設定<br>
                    • スタッフ情報を入力<br>
                    • 役割（A/B/C/ネコ）を選択
                </div>
            </div>
            """, unsafe_allow_html=True)
        with cols[1]:
            st.markdown("""
            <div class="help-card">
                <div class="help-card-icon">🌸</div>
                <p style="color: #b0b0b0; font-size: 12px; margin-bottom: 4px;">STEP 02</p>
                <h3>希望休の入力</h3>
                <div style="text-align: left; font-size: 13px; color: #555;">
                    • 「希望休入力」でチェック<br>
                    • お休みの日に✔マーク<br>
                    • 入力完了後「保存」を押す
                </div>
            </div>
            """, unsafe_allow_html=True)
        with cols[2]:
            st.markdown("""
            <div class="help-card">
                <div class="help-card-icon">✨</div>
                <p style="color: #b0b0b0; font-size: 12px; margin-bottom: 4px;">STEP 03</p>
                <h3>シフト作成</h3>
                <div style="text-align: left; font-size: 13px; color: #555;">
                    • 「シフト作成」をクリック<br>
                    • AIが自動で計算します<br>
                    • CSVで書き出しOK
                </div>
            </div>
            """, unsafe_allow_html=True)
        st.markdown("---")
        col_help_1, col_help_2 = st.columns(2)
        with col_help_1:
            # 動的に役割説明テーブルを生成
            roles_cfg = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
            role_rows = ""
            for r in roles_cfg:
                role_rows += f"            | {r['name']} |  |\n"
            role_rows += "            | 〇 |  |\n"
            role_rows += "            | ／ | 公休 |\n"
            role_rows += "            | × | 希望休 |"
            st.markdown(f"""
            **💡 役割の説明**
            | 記号 | 意味 |
            |------|------|
{role_rows}
            """)
        with col_help_2:
            # 動的にシフト色テーブルを生成
            color_emoji_map = {
                '#b3e5fc': '🟦', '#c8e6c9': '🟩', '#fff9c4': '🟨',
                '#ffe0b2': '🟧', '#e8deef': '🟪', '#f48fb1': '🟥',
            }
            color_rows = ""
            for r in roles_cfg:
                emoji = color_emoji_map.get(r.get('color', ''), '🔵')
                color_rows += f"            | {emoji} | {r['name']} |\n"
            color_rows += "            | 🟪 | 通常勤務 |\n"
            color_rows += "            | 🟥 | 人員不足 |"
            st.markdown(f"""
            **🎨 シフト表の色**
            | 色 | 意味 |
            |----|------|
{color_rows}
            """)
        if st.button("✅ ガイドを閉じる"):
            st.session_state.show_help = False
            st.rerun()


# =============================================
# サイドバー
# =============================================
with st.sidebar:
    st.markdown("""
    <div style="text-align: center; padding: 8px 0 16px 0;">
        <span style="font-size: 24px;">📅</span>
        <span style="font-size: 18px; font-weight: 700; color: #e8927c; margin-left: 4px;">シフト作成ツール</span>
    </div>
    """, unsafe_allow_html=True)

    # --- データ管理 ---
    st.markdown("#### 🗂️ データ管理")
    col_s1, col_s2 = st.columns(2)
    with col_s1:
        if st.button("📥 保存", use_container_width=True):
            try:
                save_settings_to_file(
                    st.session_state.staff_df,
                    st.session_state.holidays_df,
                    st.session_state.required_work_df,
                    st.session_state.memos,
                    st.session_state.start_date,
                    st.session_state.end_date,
                    st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
                )
                st.success("保存しました！")
            except Exception as e:
                st.error(f"保存エラー: {e}")
    with col_s2:
        if st.button("📤 読込", use_container_width=True):
            result = load_settings_from_file()
            if result[0] is not None:
                loaded_staff, loaded_hol, loaded_req, loaded_memos, loaded_start, loaded_end, loaded_roles = result
                st.session_state.staff_df = loaded_staff
                st.session_state.holidays_df = loaded_hol
                st.session_state.required_work_df = loaded_req
                st.session_state.memos = loaded_memos if loaded_memos else {}
                st.session_state.roles_config = loaded_roles if loaded_roles else [dict(r) for r in DEFAULT_ROLES_CONFIG]
                if loaded_start and loaded_end:
                    st.session_state.start_date = loaded_start
                    st.session_state.end_date = loaded_end
                st.success("読み込みました！")
                st.rerun()
            else:
                st.warning("保存データが見つかりません")

    st.divider()

    # --- シフト期間 ---
    st.markdown("#### 📆 シフト期間")
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
    st.markdown("#### 📋 バックアップ")
    backup_data = {
        "staff": st.session_state.staff_df.to_dict(),
        "holidays": st.session_state.holidays_df.to_dict(),
        "required_work": st.session_state.required_work_df.to_dict(),
        "memos": st.session_state.memos,
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
            if "required_work" in uploaded_data:
                st.session_state.required_work_df = pd.DataFrame(uploaded_data["required_work"])
            if "memos" in uploaded_data:
                st.session_state.memos = uploaded_data["memos"]
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

    # --- 履歴閲覧 ---
    st.markdown("#### 📈 過去のシフト")
    history_list = load_shift_history_list()
    if history_list:
        history_options = {
            f"{h['period'].get('start', '?')} 〜 {h['period'].get('end', '?')} ({h['staff_count']}人)": h
            for h in history_list
        }
        selected_history = st.selectbox(
            "過去のシフトを選択",
            options=["選択してください"] + list(history_options.keys()),
            key="history_select"
        )
        if selected_history != "選択してください":
            h_info = history_options[selected_history]
            col_h1, col_h2 = st.columns(2)
            with col_h1:
                if st.button("📖 閲覧", use_container_width=True, key="view_history"):
                    st.session_state.viewing_history = h_info['filepath']
                    st.rerun()
            with col_h2:
                if st.button("🗑️ 削除", use_container_width=True, key="del_history"):
                    delete_shift_history(h_info['filepath'])
                    st.success("削除しました")
                    st.rerun()
    else:
        st.caption("履歴はまだありません")

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
# 過去シフト閲覧モード
# =============================================
if st.session_state.get('viewing_history'):
    filepath = st.session_state.viewing_history
    try:
        hist_df, hist_data = load_shift_history_detail(filepath)
        st.subheader("📈 過去のシフト閲覧")
        period = hist_data.get('period', {})
        st.caption(f"期間: {period.get('start', '?')} 〜 {period.get('end', '?')}")
        roles_cfg = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
        styled = hist_df.style.apply(lambda data: highlight_cells(data, roles_config=roles_cfg), axis=None)
        st.dataframe(styled, use_container_width=True, height=400)
        if st.button("← 戻る", key="back_from_history"):
            del st.session_state.viewing_history
            st.rerun()
    except Exception as e:
        st.error(f"履歴の読み込みに失敗しました: {e}")
        if st.button("← 戻る", key="back_from_history_err"):
            del st.session_state.viewing_history
            st.rerun()
    st.stop()


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
# 🎭 役割設定
# =============================================
with st.expander("🎭 **役割設定** — 追加・削除・優先順位", expanded=False):
    st.caption("役割の追加・削除・名前変更・必要人数・優先順位を設定できます。")
    
    roles_cfg = st.session_state.get('roles_config', [dict(r) for r in DEFAULT_ROLES_CONFIG])
    
    # デフォルトカラーパレット（新規追加用）
    color_palette = [
        ("#b3e5fc", "#1a5276"), ("#c8e6c9", "#1b5e20"), ("#fff9c4", "#5d4e00"),
        ("#ffe0b2", "#5d3a00"), ("#f0e6ff", "#4a2d7a"), ("#fce4ec", "#880e4f"),
        ("#e0f7fa", "#006064"), ("#f3e5f5", "#4a148c")
    ]
    
    # ヘッダーラベル
    label_cols = st.columns([2, 1, 1, 0.5])
    with label_cols[0]:
        st.caption("名前")
    with label_cols[1]:
        st.caption("必要人数/日")
    with label_cols[2]:
        st.caption("優先順位（小=高）")
    with label_cols[3]:
        st.caption("削除")
    
    # 削除対象を記録（ループ中に削除しない）
    delete_idx = None
    
    for idx, role in enumerate(roles_cfg):
        r_cols = st.columns([2, 1, 1, 0.5])
        with r_cols[0]:
            new_name = st.text_input(
                "役割名", value=role["name"],
                key=f"role_name_{idx}", label_visibility="collapsed"
            )
            # 名前変更はセッション上のみ（カラム名は保存時に同期）
            if new_name != role["name"]:
                role["name"] = new_name
        with r_cols[1]:
            role["min_per_day"] = st.number_input(
                "必要人数", 0, 10, role.get("min_per_day", 1),
                key=f"role_min_{idx}", label_visibility="collapsed"
            )
        with r_cols[2]:
            role["priority"] = st.number_input(
                "優先順位", 1, 99, role.get("priority", idx + 1),
                key=f"role_pri_{idx}", label_visibility="collapsed"
            )
        with r_cols[3]:
            if st.button("🗑️", key=f"del_role_{idx}"):
                delete_idx = idx
    
    # 削除処理（ループ外で安全に実行）
    if delete_idx is not None:
        rname = roles_cfg[delete_idx]["name"]
        if rname in st.session_state.staff_df.columns:
            st.session_state.staff_df = st.session_state.staff_df.drop(columns=[rname])
        roles_cfg.pop(delete_idx)
        st.session_state.roles_config = roles_cfg
        st.rerun()
    
    # 役割追加・リセットボタン
    add_col, reset_col = st.columns(2)
    with add_col:
        if st.button("➕ 新しい役割を追加", key="add_role", use_container_width=True):
            new_idx = len(roles_cfg)
            ci = new_idx % len(color_palette)
            new_role = {
                "name": f"役割{new_idx + 1}",
                "min_per_day": 1,
                "priority": new_idx + 1,
                "color": color_palette[ci][0],
                "text_color": color_palette[ci][1]
            }
            roles_cfg.append(new_role)
            st.session_state.staff_df[new_role["name"]] = False
            st.session_state.roles_config = roles_cfg
            st.rerun()
    
    with reset_col:
        if st.button("🔄 デフォルトに戻す", key="reset_roles", use_container_width=True):
            st.session_state.roles_config = [dict(r) for r in DEFAULT_ROLES_CONFIG]
            st.rerun()
    
    # 変更をセッションに反映（ファイル保存はサイドバーの「📥 保存」で）
    st.session_state.roles_config = roles_cfg
    st.caption("💡 設定変更はサイドバーの「📥 保存」で保存されます。")




# =============================================
# スタッフ設定
# =============================================
with st.expander("👥 **スタッフ設定**", expanded=True):
    st.caption("スタッフの情報を入力してください。行を追加・削除できます。")
    
    # 動的に役割カラムが存在するかチェックし、なければ追加
    roles_cfg = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
    for role in roles_cfg:
        if role["name"] not in st.session_state.staff_df.columns:
            st.session_state.staff_df[role["name"]] = False
    
    # 優先役割カラムの追加
    if "優先役割" not in st.session_state.staff_df.columns:
        st.session_state.staff_df["優先役割"] = "なし"

    # バリデーション：名前の重複チェック
    names = st.session_state.staff_df['名前'].dropna().tolist()
    duplicates = [n for n in set(names) if names.count(n) > 1 and n != '']
    if duplicates:
        st.warning(f"⚠️ 名前が重複しています: {', '.join(duplicates)}")

    # 優先役割の選択肢を動的に生成
    role_options = ["なし"] + [r["name"] for r in roles_cfg]
    
    edited_staff = st.data_editor(
        st.session_state.staff_df,
        use_container_width=True,
        num_rows="dynamic",
        column_config={
            "優先役割": st.column_config.SelectboxColumn(
                "優先役割",
                options=role_options,
                default="なし",
                help="このスタッフに優先的に割り当てたい役割"
            )
        },
        key="staff_editor"
    )
    st.session_state.staff_df = edited_staff

    # スタッフ人数チェック
    valid_staff = edited_staff.dropna(subset=['名前'])
    valid_staff = valid_staff[valid_staff['名前'] != '']
    min_staff_required = sum(r.get('min_per_day', 1) for r in roles_cfg)
    if len(valid_staff) < min_staff_required:
        st.warning(f"⚠️ シフトを作成するには最低{min_staff_required}人のスタッフが必要です（現在{len(valid_staff)}人）")


# =============================================
# 共通の日付カラム関連ヘルパー
# =============================================
def sync_df_to_staff_and_days(target_df, num_staff, num_days, needed_cols):
    """DataFrameの列数・行数をスタッフ数・日数に合わせて同期する"""
    current_cols = list(target_df.columns)

    if needed_cols != current_cols:
        new_df = pd.DataFrame(False, index=range(num_staff), columns=needed_cols)
        for c in needed_cols:
            if c in target_df.columns:
                for j in range(min(len(new_df), len(target_df))):
                    if j in target_df.index:
                        new_df.at[j, c] = target_df.at[j, c]
        target_df = new_df

    if len(target_df) != num_staff:
        new_df = pd.DataFrame(False, index=range(num_staff), columns=needed_cols)
        for j in range(min(len(new_df), len(target_df))):
            for c in needed_cols:
                if c in target_df.columns and j in target_df.index:
                    new_df.at[j, c] = target_df.at[j, c]
        target_df = new_df

    return target_df


def create_display_df(target_df, staff_df, days_list, display_cols):
    """内部DataFrameを表示用に変換する（スタッフ名をインデックスに）"""
    display_df = target_df.copy()
    display_df.index = [
        staff_df.iloc[j]['名前']
        if j < len(staff_df) else f"Staff_{j}"
        for j in range(len(display_df))
    ]
    display_df = display_df.rename(columns=display_cols)
    return display_df


def apply_edited_df(edited_df, reverse_cols, target_df, staff_df):
    """編集されたDataFrameを元の内部形式に戻す"""
    result_df = edited_df.rename(columns=reverse_cols)
    result_df.index = staff_df.index[:len(result_df)]
    result_df.columns = target_df.columns[:len(result_df.columns)]
    return result_df


# --- 日付カラム関連の共通変数 ---
needed_cols = [f"Day_{i+1}" for i in range(num_days)]
display_cols = {}
for i, day in enumerate(days_list):
    wd = weekdays_jp[day.weekday()]
    hol = "祝" if is_holiday(day) else ""
    display_cols[f"Day_{i+1}"] = f"{day.day}({wd}){hol}"
reverse_cols = {v: k for k, v in display_cols.items()}


# =============================================
# 希望休入力
# =============================================
with st.expander("🏖️ **希望休入力**", expanded=True):
    st.caption("休みたい日にチェックを入れてください。")

    st.session_state.holidays_df = sync_df_to_staff_and_days(
        st.session_state.holidays_df, len(st.session_state.staff_df), num_days, needed_cols
    )

    h_display_df = create_display_df(
        st.session_state.holidays_df, st.session_state.staff_df, days_list, display_cols
    )

    edited_h = st.data_editor(
        h_display_df,
        use_container_width=True,
        key="holidays_editor"
    )

    st.session_state.holidays_df = apply_edited_df(
        edited_h, reverse_cols, st.session_state.holidays_df, st.session_state.staff_df
    )


# =============================================
# 出勤指定入力
# =============================================
with st.expander("✅ **出勤指定入力**", expanded=False):
    st.caption("この日に必ず出勤させたいスタッフにチェックを入れてください。希望休と被った場合は出勤が優先されます。")

    st.session_state.required_work_df = sync_df_to_staff_and_days(
        st.session_state.required_work_df, len(st.session_state.staff_df), num_days, needed_cols
    )

    rw_display_df = create_display_df(
        st.session_state.required_work_df, st.session_state.staff_df, days_list, display_cols
    )

    edited_rw = st.data_editor(
        rw_display_df,
        use_container_width=True,
        key="required_work_editor"
    )

    st.session_state.required_work_df = apply_edited_df(
        edited_rw, reverse_cols, st.session_state.required_work_df, st.session_state.staff_df
    )


# =============================================
# コンフリクト警告
# =============================================
conflict_list = []
for i in range(min(len(st.session_state.holidays_df), len(st.session_state.required_work_df))):
    staff_name = st.session_state.staff_df.iloc[i]['名前'] if i < len(st.session_state.staff_df) else f"Staff_{i}"
    for col in needed_cols:
        if col in st.session_state.holidays_df.columns and col in st.session_state.required_work_df.columns:
            h_val = st.session_state.holidays_df.at[i, col] if i in st.session_state.holidays_df.index else False
            r_val = st.session_state.required_work_df.at[i, col] if i in st.session_state.required_work_df.index else False
            if h_val and r_val:
                day_idx = int(col.replace("Day_", "")) - 1
                if day_idx < len(days_list):
                    day_str = f"{days_list[day_idx].month}/{days_list[day_idx].day}"
                    conflict_list.append(f"**{staff_name}** — {day_str}")

if conflict_list:
    st.warning(
        f"⚠️ **コンフリクト警告**: 希望休と出勤指定が重複しています（出勤指定が優先されます）\n\n"
        + "\n".join([f"- {c}" for c in conflict_list])
    )


# =============================================
# メモ・連絡事項
# =============================================
with st.expander("📝 **メモ・連絡事項**", expanded=False):
    st.caption("日ごとのメモを入力できます（イベント、研修、特記事項など）")
    if 'memos' not in st.session_state:
        st.session_state.memos = {}

    # メモを2列で表示
    memo_cols = st.columns(2)
    for i, day in enumerate(days_list):
        wd = weekdays_jp[day.weekday()]
        day_key = day.strftime("%Y-%m-%d")
        with memo_cols[i % 2]:
            memo_val = st.text_input(
                f"{day.month}/{day.day}({wd})",
                value=st.session_state.memos.get(day_key, ""),
                key=f"memo_{day_key}",
                placeholder="メモを入力..."
            )
            if memo_val:
                st.session_state.memos[day_key] = memo_val
            elif day_key in st.session_state.memos:
                del st.session_state.memos[day_key]


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
                roles_cfg = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
                result_df = solve_schedule_from_ui(
                    st.session_state.staff_df,
                    st.session_state.holidays_df,
                    days_list,
                    constraints,
                    priority_days,
                    required_work_df=st.session_state.required_work_df,
                    roles_config=roles_cfg
                )

                if result_df is not None:
                    st.success("✅ シフトが完成しました！")

                    # --- 履歴に自動保存 ---
                    try:
                        save_shift_history(
                            result_df, st.session_state.staff_df,
                            st.session_state.start_date, st.session_state.end_date
                        )
                    except Exception:
                        pass  # 履歴保存失敗は無視

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

                    # --- メモ表示（入力がある日のみ） ---
                    active_memos = {k: v for k, v in st.session_state.memos.items() if v}
                    if active_memos:
                        with st.expander("📝 **メモ・連絡事項**", expanded=False):
                            for day_key, memo in sorted(active_memos.items()):
                                try:
                                    memo_date = datetime.datetime.strptime(day_key, "%Y-%m-%d").date()
                                    wd = weekdays_jp[memo_date.weekday()]
                                    st.markdown(f"**{memo_date.month}/{memo_date.day}({wd})**: {memo}")
                                except Exception:
                                    st.markdown(f"**{day_key}**: {memo}")

                    # --- シフト表表示 ---
                    roles_cfg_for_style = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
                    styled = result_df.style.apply(lambda data: highlight_cells(data, roles_config=roles_cfg_for_style), axis=None)
                    st.dataframe(styled, use_container_width=True, height=400)

                    # --- 公平性ダッシュボード ---
                    with st.expander("📊 **公平性ダッシュボード**", expanded=False):
                        staff_names = [n for n in result_df.index if n != "不足"]

                        # 各スタッフの役割分布を計算
                        rc_cfg = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
                        role_keys = {r['name']: 0 for r in rc_cfg}
                        role_keys['〇'] = 0
                        role_counts = {name: dict(role_keys) for name in staff_names}
                        weekend_work = {name: 0 for name in staff_names}

                        for name in staff_names:
                            for col in result_df.columns:
                                if col[0] == '勤(休)':
                                    continue
                                val = result_df.at[name, col]
                                if val in role_counts[name]:
                                    role_counts[name][val] += 1
                                # 土日出勤カウント
                                if col[1] in ['土', '日', '祝']:
                                    if val not in ['／', '×', '', '※']:
                                        weekend_work[name] += 1

                        # 土日出勤回数グラフ
                        st.markdown("##### 🗓️ 土日祝出勤回数")
                        weekend_chart_df = pd.DataFrame({
                            '名前': list(weekend_work.keys()),
                            '土日祝出勤': list(weekend_work.values())
                        }).set_index('名前')
                        st.bar_chart(weekend_chart_df)

                        # 役割分布グラフ
                        st.markdown("##### 🎭 役割分布")
                        role_chart_df = pd.DataFrame(role_counts).T
                        st.bar_chart(role_chart_df)

                        # 勤務日数の偏差
                        st.markdown("##### ⚖️ 勤務バランス")
                        work_counts = {}
                        for name in staff_names:
                            count = 0
                            for col in result_df.columns:
                                if col[0] != '勤(休)':
                                    val = result_df.at[name, col]
                                    if val not in ['／', '×', '', '※']:
                                        count += 1
                            work_counts[name] = count

                        if work_counts:
                            avg_work = sum(work_counts.values()) / len(work_counts)
                            balance_cols = st.columns(min(len(staff_names), 4))
                            for idx, (name, count) in enumerate(work_counts.items()):
                                with balance_cols[idx % len(balance_cols)]:
                                    diff = count - avg_work
                                    st.metric(name, f"{count}日",
                                             delta=f"{diff:+.1f}日" if diff != 0 else "平均")

                    # --- 手動微調整 ---
                    with st.expander("🔧 **手動微調整**", expanded=False):
                        st.caption("シフトを手動で修正できます。変更後は下の「修正版をダウンロード」ボタンからCSVを取得してください。")
                        edited_result = st.data_editor(
                            result_df,
                            use_container_width=True,
                            key="manual_edit"
                        )

                        # 修正版のCSVダウンロード
                        csv_modified = generate_custom_csv(
                            edited_result, st.session_state.staff_df, days_list
                        )
                        st.download_button(
                            "📄 修正版CSVをダウンロード",
                            data=csv_modified,
                            file_name=f"shift_modified_{st.session_state.start_date}_{st.session_state.end_date}.csv",
                            mime="text/csv",
                            use_container_width=True
                        )

                    # --- プレビューモード ---
                    with st.expander("📱 **プレビューモード** （印刷・共有用）", expanded=False):
                        st.caption("コンパクトな表示で印刷やスクリーンショットに最適です。")

                        # HTMLテーブルを生成
                        preview_html = '<table style="border-collapse: collapse; width: 100%; font-size: 11px; font-family: sans-serif;">'

                        # ヘッダー行1（日にち）
                        preview_html += '<tr style="background: linear-gradient(135deg, #f5a08c, #e8927c); color: white;">'
                        preview_html += '<th style="padding: 4px 6px; border: 1px solid #ddd; position: sticky; left: 0; background: #e8927c;">名前</th>'
                        for col in result_df.columns:
                            if col[0] == '勤(休)':
                                preview_html += f'<th style="padding: 4px 6px; border: 1px solid #ddd; background: #e8927c;">勤(休)</th>'
                            else:
                                bg_color = '#e8927c'
                                if col[1] == '土':
                                    bg_color = '#6da7d4'
                                elif col[1] in ['日', '祝']:
                                    bg_color = '#d46d6d'
                                preview_html += f'<th style="padding: 4px 4px; border: 1px solid #ddd; background: {bg_color};">{col[0]}<br><span style="font-size: 9px;">{col[1]}</span></th>'
                        preview_html += '</tr>'

                        # データ行
                        # 動的にカラーマップを生成
                        preview_roles_cfg = st.session_state.get('roles_config', DEFAULT_ROLES_CONFIG)
                        color_map = {}
                        for r in preview_roles_cfg:
                            color_map[r['name']] = (r.get('color', '#e8deef'), r.get('text_color', '#333'))
                        color_map.update({
                            '〇': ('#e8deef', '#3a2d5e'), '／': ('#f5d0d0', '#5a3e3e'),
                            '×': ('#e0dede', '#777'), '※': ('#f48fb1', 'white')
                        })
                        for name in result_df.index:
                            preview_html += '<tr>'
                            preview_html += f'<td style="padding: 3px 6px; border: 1px solid #eee; font-weight: bold; background: #fffaf8; position: sticky; left: 0;">{name}</td>'
                            for col in result_df.columns:
                                val = str(result_df.at[name, col])
                                bg, fg = color_map.get(val, ('#fff', '#333'))
                                preview_html += f'<td style="padding: 2px 4px; border: 1px solid #eee; text-align: center; background: {bg}; color: {fg};">{val}</td>'
                            preview_html += '</tr>'

                        preview_html += '</table>'
                        st.markdown(preview_html, unsafe_allow_html=True)

                    # --- CSVダウンロード ---
                    st.markdown("---")
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
    "<div style='text-align: center; color: #c0a0a0; font-size: 12px; padding: 8px 0;'>"
    "📅 シフト作成ツール v3.0 | Powered by Streamlit"
    "</div>",
    unsafe_allow_html=True
)