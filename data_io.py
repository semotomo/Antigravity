# データ入出力 — シフト作成ツール

import json
import os
import datetime
import pandas as pd

from utils import is_holiday

# --- 定数 ---
SETTINGS_FILE = "shift_settings.json"


# --- 設定の読み込み ---
def load_settings_from_file():
    """shift_settings.json から設定データを読み込む"""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                loaded_data = json.load(f)
            staff_df = pd.DataFrame(loaded_data["staff"])
            for col in ["正社員", "朝可", "夜可", "A", "B", "C", "ネコ", "最大連勤"]:
                if col not in staff_df.columns:
                    if col == "最大連勤":
                        staff_df[col] = 4
                    elif col == "正社員":
                        staff_df[col] = False
                    elif col == "朝可":
                        staff_df[col] = True
                    else:
                        staff_df[col] = False
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
            return staff_df, pd.DataFrame(loaded_data["holidays"]), start_d, end_d
        except Exception:
            return None, None, None, None
    return None, None, None, None


# --- デフォルトデータ生成 ---
def get_default_data():
    """デフォルトのスタッフ情報と休暇データを生成する"""
    staff_data = {
        "名前": ["正社員A_1", "正社員A_2", "正社員B_1", "正社員B_2",
                 "パート夜", "パート朝1", "パート朝2"],
        "正社員": [True, True, True, True, False, False, False],
        "朝可": [True, True, True, True, False, True, True],
        "夜可": [True, True, True, True, True, False, False],
        "A": [True, True, False, False, False, False, False],
        "B": [False, True, True, True, False, False, False],
        "C": [False, False, True, True, False, True, True],
        "ネコ": [False, True, True, True, False, True, True],
        "前月末の連勤数": [0, 5, 1, 0, 0, 2, 2],
        "最大連勤": [4, 4, 4, 4, 3, 4, 3],
        "公休数": [8, 8, 8, 8, 13, 9, 15]
    }
    holidays_data = pd.DataFrame(
        False, index=range(7),
        columns=[f"Day_{i+1}" for i in range(31)]
    )
    return pd.DataFrame(staff_data), holidays_data


# --- 設定の保存 ---
def save_settings_to_file(staff_df, holidays_df, start_date, end_date):
    """設定データをshift_settings.jsonに保存する"""
    clean_staff_df = staff_df.dropna(subset=['名前'])
    clean_staff_df = clean_staff_df[clean_staff_df['名前'] != '']
    data = {
        "staff": clean_staff_df.to_dict(),
        "holidays": holidays_df.to_dict(),
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
