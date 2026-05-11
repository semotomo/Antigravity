# ユーティリティ関数 — シフト作成ツール

import datetime
import itertools
import pandas as pd


# --- デフォルト役割設定 ---
DEFAULT_ROLES_CONFIG = [
    {"name": "A",    "min_per_day": 1, "priority": 1, "color": "#b3e5fc", "text_color": "#1a5276"},
    {"name": "B",    "min_per_day": 1, "priority": 2, "color": "#c8e6c9", "text_color": "#1b5e20"},
    {"name": "C",    "min_per_day": 1, "priority": 3, "color": "#fff9c4", "text_color": "#5d4e00"},
    {"name": "ネコ",  "min_per_day": 1, "priority": 4, "color": "#ffe0b2", "text_color": "#5d3a00"},
]

# 固定表示記号（役割ではなく状態を表す）
FIXED_SYMBOLS = {
    "〇": {"color": "#e8deef", "text_color": "#3a2d5e"},    # 通常勤務
    "／": {"color": "#f5d0d0", "text_color": "#5a3e3e"},    # 公休
    "×": {"color": "#e0dede", "text_color": "#777"},        # 希望休
    "※": {"color": "#f48fb1", "text_color": "white"},       # 人員不足
}


# --- 祝日判定関数 ---
def is_holiday(d):
    """日付が祝日かどうかを判定する"""
    try:
        import jpholiday
        if jpholiday.is_holiday(d):
            return True
    except ImportError:
        pass
    # フォールバック用：2026年の祝日リスト
    holidays_2026 = [
        datetime.date(2026, 1, 1), datetime.date(2026, 1, 12),
        datetime.date(2026, 2, 11), datetime.date(2026, 2, 23),
        datetime.date(2026, 3, 20), datetime.date(2026, 4, 29),
        datetime.date(2026, 5, 3), datetime.date(2026, 5, 4),
        datetime.date(2026, 5, 5), datetime.date(2026, 5, 6),
        datetime.date(2026, 7, 20), datetime.date(2026, 8, 11),
        datetime.date(2026, 9, 21), datetime.date(2026, 9, 22),
        datetime.date(2026, 9, 23), datetime.date(2026, 10, 12),
        datetime.date(2026, 11, 3), datetime.date(2026, 11, 23)
    ]
    return d in holidays_2026


# --- 役割名の内部キー変換 ---
def _role_internal_key(role_name):
    """役割名を内部キーに変換する（ネコ→Neko、その他はそのまま）"""
    # 内部的には日本語名でもそのまま使う（Nekoの特殊扱いを維持）
    return role_name


# --- 役割マップ生成（動的対応） ---
def get_role_map_from_df(staff_df, roles_config=None):
    """スタッフDataFrameから、各スタッフのインデックス→役割セットのマップを生成する
    
    roles_config: 役割設定リスト。Noneの場合はDEFAULT_ROLES_CONFIGを使用。
    """
    if roles_config is None:
        roles_config = DEFAULT_ROLES_CONFIG
    
    role_map = {}
    df = staff_df.reset_index(drop=True)
    
    # 動的に設定された役割名のリストを取得
    role_names = [r["name"] for r in roles_config]
    
    for i, row in df.iterrows():
        roles = set()
        # 動的役割のチェック
        for rname in role_names:
            if rname in df.columns and row.get(rname, False):
                roles.add(rname)
        # 固定属性（朝可/夜可）は常にチェック
        if "夜可" in df.columns and row.get("夜可", False):
            roles.add("Night")
        if "朝可" in df.columns and row.get("朝可", False):
            roles.add("Morning")
        role_map[i] = roles
    return role_map


# --- 役割カバー判定（動的対応） ---
def can_cover_required_roles(staff_list, role_map, constraints, roles_config=None):
    """指定されたスタッフリストで必要な役割をカバーできるかチェックする
    
    roles_config: 役割設定リスト。各役割の min_per_day を参照。
    """
    if roles_config is None:
        roles_config = DEFAULT_ROLES_CONFIG
    
    # 朝/夜の最低人数チェック（固定属性）
    if sum(1 for s in staff_list if "Night" in role_map[s]) < constraints.get('min_night', 3):
        return False
    if sum(1 for s in staff_list if "Morning" in role_map[s]) < constraints.get('min_morning', 3):
        return False

    # 各役割の必要人数チェック（貪欲法で割り当て可能かを確認）
    # 優先順位順にソートして、高優先の役割から割り当て
    sorted_roles = sorted(roles_config, key=lambda r: r.get("priority", 999))
    
    # 各役割の必要人数を合計して、最低必要人数を計算
    total_min = sum(r.get("min_per_day", 1) for r in sorted_roles)
    if len(staff_list) < total_min:
        return False
    
    # 各役割に対して担当可能なスタッフがいるかチェック
    assigned = set()
    for role in sorted_roles:
        rname = role["name"]
        needed = role.get("min_per_day", 1)
        candidates = [s for s in staff_list if s not in assigned and rname in role_map[s]]
        if len(candidates) < needed:
            return False
        # 貪欲に割り当て（他の役割との兼ね合いがあるので、ここでは可能性チェックのみ）
        # より正確なチェックはpermutationsで行うが、パフォーマンスのため簡易判定
        for c in candidates[:needed]:
            assigned.add(c)
    
    return True


# --- 出勤パターン生成（動的対応） ---
def get_possible_day_patterns(available_staff, roles_config=None):
    """出勤可能なスタッフから、最低人数〜最大人数の出勤組み合わせを生成する"""
    if roles_config is None:
        roles_config = DEFAULT_ROLES_CONFIG
    
    # 最低人数 = 全役割の必要人数の合計
    min_staff = sum(r.get("min_per_day", 1) for r in roles_config)
    min_staff = max(min_staff, 2)  # 最低2人は必要
    
    return [
        subset
        for size in range(min_staff, min(len(available_staff) + 1, 10))
        for subset in itertools.combinations(available_staff, size)
    ]


# --- 役割自動割り当て（動的対応） ---
def assign_roles_smartly(working_indices, role_map, roles_config=None, staff_df=None):
    """出勤メンバーに対して役割を優先順位に基づいて最適に割り当てる
    
    roles_config: 役割設定リスト。priority順に割り当てる。
    staff_df: スタッフDF（優先役割の参照用、Noneの場合は無視）
    """
    if roles_config is None:
        roles_config = DEFAULT_ROLES_CONFIG
    
    assignments = {}
    pool = list(working_indices)
    
    # 優先順位でソート
    sorted_roles = sorted(roles_config, key=lambda r: r.get("priority", 999))
    role_names = [r["name"] for r in sorted_roles]
    
    # --- フェーズ1: 優先役割が設定されているスタッフを先に割り当て ---
    role_demand = {}  # 各役割であと何人必要か
    for role in sorted_roles:
        role_demand[role["name"]] = role.get("min_per_day", 1)
    
    assigned = set()
    
    # 優先役割が設定されているスタッフを優先割り当て
    if staff_df is not None and "優先役割" in staff_df.columns:
        df_reset = staff_df.reset_index(drop=True)
        for s in pool:
            if s < len(df_reset):
                pref = df_reset.at[s, "優先役割"]
                if pd.notna(pref) and pref != "" and pref != "なし":
                    if pref in role_demand and role_demand[pref] > 0 and pref in role_map[s]:
                        assignments[s] = pref
                        assigned.add(s)
                        role_demand[pref] -= 1
    
    # --- フェーズ2: 残りを優先順位順で割り当て ---
    remaining = [s for s in pool if s not in assigned]
    
    # まず、各役割の最低人数を満たす割り当てを試みる
    for role in sorted_roles:
        rname = role["name"]
        needed = role_demand.get(rname, 0)
        if needed <= 0:
            continue
        
        # この役割ができる未割り当てスタッフを見つける
        candidates = [s for s in remaining if rname in role_map[s]]
        
        # 「この役割しかできない（or 選択肢が少ない）」スタッフを優先
        # → 他の役割の候補数が少ない順にソート
        def versatility_score(s):
            return sum(1 for r in role_names if r in role_map[s])
        candidates.sort(key=versatility_score)
        
        for c in candidates[:needed]:
            assignments[c] = rname
            assigned.add(c)
            remaining.remove(c)
            role_demand[rname] -= 1
    
    # --- フェーズ3: 余ったスタッフに追加役割 or 〇を割り当て ---
    for s in remaining:
        caps = role_map[s]
        # 何か役割ができる場合は、優先順位が低い役割から追加割り当て
        assigned_extra = False
        for role in reversed(sorted_roles):
            rname = role["name"]
            if rname in caps:
                assignments[s] = rname
                assigned_extra = True
                break
        if not assigned_extra:
            # どの役割もできない場合は通常勤務
            assignments[s] = '〇'
    
    return assignments


# --- カラーリングロジック（動的対応） ---
def highlight_cells(data, roles_config=None):
    """シフト表のセルに役割・曜日に応じた背景色を適用する（やわらかいパステル調）"""
    if roles_config is None:
        roles_config = DEFAULT_ROLES_CONFIG
    
    styles = pd.DataFrame('', index=data.index, columns=data.columns)

    # 動的に役割→色のマップを作成
    role_color_map = {}
    for role in roles_config:
        role_color_map[role["name"]] = {
            "bg": role.get("color", "#e8deef"),
            "text": role.get("text_color", "#333")
        }

    for col in data.columns:
        week_str = col[1]
        if week_str == '土':
            styles[col] = 'background-color: #e8f4fd;'
        elif week_str in ['日', '祝']:
            styles[col] = 'background-color: #fce8e8;'

    for r in data.index:
        for c in data.columns:
            val = data.at[r, c]
            # 勤休列のスタイル
            if c[0] == '勤(休)':
                styles.at[r, c] += 'font-weight: bold; background-color: #faf8f6;'
                continue

            # 固定記号のスタイル
            if val in FIXED_SYMBOLS:
                sym = FIXED_SYMBOLS[val]
                style_str = f'background-color: {sym["color"]}; color: {sym["text_color"]};'
                if val == '※':
                    style_str += ' font-weight: bold;'
                styles.at[r, c] += style_str
            # 動的役割のスタイル
            elif val in role_color_map:
                rc = role_color_map[val]
                styles.at[r, c] += f'background-color: {rc["bg"]}; color: {rc["text"]};'

    return styles


# --- デフォルト日付範囲 ---
def get_default_date_range():
    """デフォルトの日付範囲を計算する（当月26日〜翌月25日）"""
    today = datetime.date.today()
    if today.day >= 26:
        start_date = today.replace(day=26)
    else:
        start_date = today.replace(day=26)
    if start_date.month == 12:
        end_date = start_date.replace(year=start_date.year + 1, month=1, day=25)
    else:
        end_date = start_date.replace(month=start_date.month + 1, day=25)
    return start_date, end_date
