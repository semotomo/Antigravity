# データ入出力 — シフト作成ツール
# 設定・出勤指定・メモ・シフト履歴・役割設定の保存と読込を管理

import json
import os
import datetime
import pandas as pd

from utils import is_holiday, DEFAULT_ROLES_CONFIG

# --- 定数 ---
SETTINGS_FILE = "shift_settings.json"
HISTORY_DIR = "shift_history"


# --- 役割設定の読み込み ---
def load_roles_config():
    """shift_settings.json から役割設定を読み込む。なければデフォルトを返す"""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                loaded_data = json.load(f)
            if "roles_config" in loaded_data:
                return loaded_data["roles_config"]
        except Exception:
            pass
    return [dict(r) for r in DEFAULT_ROLES_CONFIG]


# --- 役割設定の保存 ---
def save_roles_config(roles_config):
    """役割設定をshift_settings.jsonに追記/更新する"""
    data = {}
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = {}
    data["roles_config"] = roles_config
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# --- 設定の読み込み ---
def load_settings_from_file():
    """shift_settings.json から設定データを読み込む
    戻り値: (staff_df, holidays_df, required_work_df, memos, start_d, end_d, roles_config)
    """
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                loaded_data = json.load(f)
            
            # 役割設定の読込（後方互換：なければデフォルト）
            roles_config = loaded_data.get("roles_config", 
                                           [dict(r) for r in DEFAULT_ROLES_CONFIG])
            role_names = [r["name"] for r in roles_config]
            
            staff_df = pd.DataFrame(loaded_data["staff"])
            
            # 固定カラムの補完
            fixed_defaults = {
                "正社員": False, "朝可": True, "夜可": False, "最大連勤": 4
            }
            for col, default in fixed_defaults.items():
                if col not in staff_df.columns:
                    staff_df[col] = default
            
            # 動的役割カラムの補完（設定にある役割がDFにない場合はFalseで追加）
            for rname in role_names:
                if rname not in staff_df.columns:
                    staff_df[rname] = False
            
            # 古い役割カラムの処理（設定から削除された役割がDFに残っている場合）
            # → 削除はせず、そのまま残す（データ保全のため）

            holidays_df = pd.DataFrame(loaded_data["holidays"])

            # 出勤指定データの読込（後方互換：キーがなければ全False）
            if "required_work" in loaded_data:
                required_work_df = pd.DataFrame(loaded_data["required_work"])
            else:
                required_work_df = pd.DataFrame(
                    False, index=holidays_df.index, columns=holidays_df.columns
                )

            # メモデータの読込（後方互換：キーがなければ空辞書）
            memos = loaded_data.get("memos", {})

            start_d, end_d = None, None
            if "date_range" in loaded_data:
                try:
                    start_d = datetime.datetime.strptime(
                        loaded_data["date_range"]["start"], "%Y-%m-%d"
                    ).date()
                    end_d = datetime.datetime.strptime(
                        loaded_data["date_range"]["end"], "%Y-%m-%d"
                    ).date()
                except Exception:
                    pass
            return staff_df, holidays_df, required_work_df, memos, start_d, end_d, roles_config
        except Exception:
            return None, None, None, None, None, None, None
    return None, None, None, None, None, None, None


# --- デフォルトデータ生成（動的対応） ---
def get_default_data(roles_config=None):
    """デフォルトのスタッフ情報・休暇・出勤指定データを生成する"""
    if roles_config is None:
        roles_config = DEFAULT_ROLES_CONFIG
    
    role_names = [r["name"] for r in roles_config]
    
    # 基本スタッフデータ
    staff_data = {
        "名前": ["正社員A_1", "正社員A_2", "正社員B_1", "正社員B_2",
                 "パート夜", "パート朝1", "パート朝2"],
        "正社員": [True, True, True, True, False, False, False],
        "朝可": [True, True, True, True, False, True, True],
        "夜可": [True, True, True, True, True, False, False],
        "前月末の連勤数": [0, 5, 1, 0, 0, 2, 2],
        "最大連勤": [4, 4, 4, 4, 3, 4, 3],
        "公休数": [8, 8, 8, 8, 13, 9, 15]
    }
    
    # デフォルト4役割の場合は既存のデフォルト値を使用
    default_role_values = {
        "A":    [True, True, False, False, False, False, False],
        "B":    [False, True, True, True, False, False, False],
        "C":    [False, False, True, True, False, True, True],
        "ネコ":  [False, True, True, True, False, True, True],
    }
    
    for rname in role_names:
        if rname in default_role_values:
            staff_data[rname] = default_role_values[rname]
        else:
            # 新しい役割は全員Falseで初期化
            staff_data[rname] = [False] * 7
    
    holidays_data = pd.DataFrame(
        False, index=range(7),
        columns=[f"Day_{i+1}" for i in range(31)]
    )
    required_work_data = pd.DataFrame(
        False, index=range(7),
        columns=[f"Day_{i+1}" for i in range(31)]
    )
    return pd.DataFrame(staff_data), holidays_data, required_work_data


# --- 設定の保存（動的対応） ---
def save_settings_to_file(staff_df, holidays_df, required_work_df, memos, 
                          start_date, end_date, roles_config=None):
    """設定データをshift_settings.jsonに保存する（役割設定も含む）"""
    if roles_config is None:
        roles_config = [dict(r) for r in DEFAULT_ROLES_CONFIG]
    
    clean_staff_df = staff_df.dropna(subset=['名前'])
    clean_staff_df = clean_staff_df[clean_staff_df['名前'] != '']
    data = {
        "staff": clean_staff_df.to_dict(),
        "holidays": holidays_df.to_dict(),
        "required_work": required_work_df.to_dict(),
        "memos": memos if memos else {},
        "roles_config": roles_config,
        "date_range": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d")
        }
    }
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# --- カスタムCSV出力 ---
def generate_custom_csv(result_df, staff_df, days_list):
    """エクセル完全対応のCSVデータを生成する（UTF-8 BOM付き）"""
    weekdays_jp = ["月", "火", "水", "木", "金", "土", "日"]

    # 1行目：本店、月表示
    row1 = ["", "本店"]
    current_m = days_list[0].month
    count = 0
    for d in days_list:
        if d.month == current_m:
            row1.append(f"　{current_m}月 " if count == 0 else "")
            count += 1
        else:
            current_m = d.month
            count = 1
            row1.append(f"　{current_m}月 ")
    row1.append("")  # 勤(休)用

    # 2行目：日にち
    row2 = ["", "日にち"] + [str(d.day) for d in days_list] + ["勤(休)"]

    # 3行目：曜日
    row3 = ["\"先月からの\n連勤日数\"", "曜日"]
    for d in days_list:
        row3.append("祝" if is_holiday(d) else weekdays_jp[d.weekday()])
    row3.append("")

    # データ行
    data_rows = []
    col_prev_cons = "前月末の連勤数" if "前月末の連勤数" in staff_df.columns else "先月からの連勤"
    prev_cons_map = {row['名前']: row[col_prev_cons] for _, row in staff_df.iterrows()}

    for name, row in result_df.iterrows():
        p_cons = prev_cons_map.get(name, 0)
        if name == "不足":
            data_rows.append(["", name] + list(row.values))
        else:
            data_rows.append([str(p_cons), name] + list(row.values))

    lines = [",".join(row1), ",".join(row2), ",".join(row3)]
    for dr in data_rows:
        lines.append(",".join([str(x) for x in dr]))
    return "\n".join(lines).encode('utf-8-sig')


# =============================================
# 履歴管理機能
# =============================================

def save_shift_history(result_df, staff_df, start_date, end_date):
    """シフト結果を履歴として保存する"""
    os.makedirs(HISTORY_DIR, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"shift_{start_date}_{end_date}_{timestamp}.json"
    filepath = os.path.join(HISTORY_DIR, filename)

    # DataFrameをJSON化可能な形式に変換
    # MultiIndexのカラムを文字列タプルに変換
    result_data = {}
    for col in result_df.columns:
        col_key = f"{col[0]}|{col[1]}"
        result_data[col_key] = result_df[col].to_dict()

    history_entry = {
        "created_at": datetime.datetime.now().isoformat(),
        "period": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d")
        },
        "staff_names": list(staff_df['名前'].dropna()),
        "result": result_data
    }

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(history_entry, f, ensure_ascii=False, indent=2)
    return filepath


def load_shift_history_list():
    """保存されたシフト履歴の一覧を取得する"""
    if not os.path.exists(HISTORY_DIR):
        return []
    files = sorted(
        [f for f in os.listdir(HISTORY_DIR) if f.endswith('.json')],
        reverse=True
    )
    history_list = []
    for f in files:
        filepath = os.path.join(HISTORY_DIR, f)
        try:
            with open(filepath, 'r', encoding='utf-8') as fp:
                data = json.load(fp)
            history_list.append({
                "filename": f,
                "filepath": filepath,
                "created_at": data.get("created_at", "不明"),
                "period": data.get("period", {}),
                "staff_count": len(data.get("staff_names", []))
            })
        except Exception:
            continue
    return history_list


def load_shift_history_detail(filepath):
    """特定のシフト履歴の詳細データを読み込む"""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # MultiIndexカラムの復元
    result_data = data["result"]
    columns_tuples = []
    col_data = {}
    for col_key, values in result_data.items():
        parts = col_key.split("|", 1)
        col_tuple = (parts[0], parts[1] if len(parts) > 1 else "")
        columns_tuples.append(col_tuple)
        col_data[col_tuple] = values

    multi_cols = pd.MultiIndex.from_tuples(columns_tuples)
    result_df = pd.DataFrame(col_data)
    result_df.columns = multi_cols

    return result_df, data


def delete_shift_history(filepath):
    """特定のシフト履歴を削除する"""
    if os.path.exists(filepath):
        os.remove(filepath)
        return True
    return False
