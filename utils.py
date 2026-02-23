# ユーティリティ関数 — シフト作成ツール

import datetime
import itertools
import pandas as pd


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


# --- 役割マップ生成 ---
def get_role_map_from_df(staff_df):
    """スタッフDataFrameから、各スタッフのインデックス→役割セットのマップを生成する"""
    role_map = {}
    df = staff_df.reset_index(drop=True)
    for i, row in df.iterrows():
        roles = set()
        if row["A"]:
            roles.add("A")
        if row["B"]:
            roles.add("B")
        if row["C"]:
            roles.add("C")
        if row["ネコ"]:
            roles.add("Neko")
        if row["夜可"]:
            roles.add("Night")
        if row["朝可"]:
            roles.add("Morning")
        role_map[i] = roles
    return role_map


# --- 役割カバー判定 ---
def can_cover_required_roles(staff_list, role_map, constraints):
    """指定されたスタッフリストで必要な役割（朝/夜/A/B/C/ネコ）をカバーできるかチェックする"""
    # 朝/夜の最低人数チェック
    if sum(1 for s in staff_list if "Night" in role_map[s]) < constraints.get('min_night', 3):
        return False
    if sum(1 for s in staff_list if "Morning" in role_map[s]) < constraints.get('min_morning', 3):
        return False

    # ネコ/ABC の割り当てチェック
    neko_cands = [s for s in staff_list if "Neko" in role_map[s]]
    p_neko = [s for s in neko_cands if "A" not in role_map[s] and "B" not in role_map[s]]
    neko_fixed = p_neko[0] if p_neko else (neko_cands[0] if neko_cands else None)

    if neko_fixed is not None:
        rem = [x for x in staff_list if x != neko_fixed]
        if len(rem) < 3:
            return False
        if not all(any(r in role_map[x] for x in rem) for r in ["A", "B", "C"]):
            return False
        for p in itertools.permutations(rem, 3):
            if 'A' in role_map[p[0]] and 'B' in role_map[p[1]] and 'C' in role_map[p[2]]:
                return True
        return False
    else:
        if len(staff_list) < 4:
            return False
        for p in itertools.permutations(staff_list, 4):
            if ('Neko' in role_map[p[0]] and 'A' in role_map[p[1]]
                    and 'B' in role_map[p[2]] and 'C' in role_map[p[3]]):
                return True
        return False


# --- 出勤パターン生成 ---
def get_possible_day_patterns(available_staff):
    """出勤可能なスタッフから、4人〜最大9人の出勤組み合わせを生成する"""
    return [
        subset
        for size in range(4, min(len(available_staff) + 1, 10))
        for subset in itertools.combinations(available_staff, size)
    ]


# --- 役割自動割り当て ---
def assign_roles_smartly(working_indices, role_map):
    """出勤メンバーに対してA/B/C/ネコ/〇の役割を最適に割り当てる"""
    assignments = {}
    pool = list(working_indices)
    neko_cands = [s for s in pool if "Neko" in role_map[s]]
    p_neko = [s for s in neko_cands if "A" not in role_map[s] and "B" not in role_map[s]]
    neko_fixed = p_neko[0] if p_neko else (neko_cands[0] if neko_cands else None)

    found_strict = False
    if neko_fixed is not None:
        rem = [x for x in pool if x != neko_fixed]
        for p in itertools.permutations(rem, 3):
            if 'A' in role_map[p[0]] and 'B' in role_map[p[1]] and 'C' in role_map[p[2]]:
                assignments[neko_fixed] = 'ネコ'
                assignments[p[0]] = 'A'
                assignments[p[1]] = 'B'
                assignments[p[2]] = 'C'
                found_strict = True
                for ex in [x for x in rem if x not in p]:
                    if (not any(r in role_map[ex] for r in ["A", "B", "C", "Neko"])
                            and "Night" in role_map[ex]):
                        assignments[ex] = '〇'
                    else:
                        caps = role_map[ex]
                        if 'C' in caps:
                            assignments[ex] = 'C'
                        elif 'B' in caps:
                            assignments[ex] = 'B'
                        elif 'A' in caps:
                            assignments[ex] = 'A'
                        elif 'Neko' in caps:
                            assignments[ex] = 'ネコ'
                        elif "Night" in role_map[ex]:
                            assignments[ex] = '〇'
                break
    else:
        for p in itertools.permutations(pool, 4):
            if ('Neko' in role_map[p[0]] and 'A' in role_map[p[1]]
                    and 'B' in role_map[p[2]] and 'C' in role_map[p[3]]):
                assignments[p[0]] = 'ネコ'
                assignments[p[1]] = 'A'
                assignments[p[2]] = 'B'
                assignments[p[3]] = 'C'
                found_strict = True
                for ex in [x for x in pool if x not in p]:
                    if (not any(r in role_map[ex] for r in ["A", "B", "C", "Neko"])
                            and "Night" in role_map[ex]):
                        assignments[ex] = '〇'
                    else:
                        caps = role_map[ex]
                        if 'C' in caps:
                            assignments[ex] = 'C'
                        elif 'B' in caps:
                            assignments[ex] = 'B'
                        elif 'A' in caps:
                            assignments[ex] = 'A'
                break

    if not found_strict:
        unassigned = set(pool)
        for r in ['A', 'B', 'Neko', 'C']:
            for s in list(unassigned):
                if r == 'Neko' and neko_fixed and neko_fixed in unassigned:
                    assignments[neko_fixed] = 'ネコ'
                    unassigned.remove(neko_fixed)
                    break
                if r in role_map[s]:
                    assignments[s] = r
                    unassigned.remove(s)
                    break
        for s in list(unassigned):
            if "Night" in role_map[s] and not any(r in role_map[s] for r in ["A", "B", "C", "Neko"]):
                assignments[s] = '〇'
            elif 'C' in role_map[s]:
                assignments[s] = 'C'
    return assignments


# --- カラーリングロジック ---
def highlight_cells(data):
    """シフト表のセルに役割・曜日に応じた背景色を適用する"""
    styles = pd.DataFrame('', index=data.index, columns=data.columns)

    for col in data.columns:
        week_str = col[1]
        if week_str == '土':
            styles[col] = 'background-color: #e6f7ff;'
        elif week_str in ['日', '祝']:
            styles[col] = 'background-color: #ffe6e6;'

    for r in data.index:
        for c in data.columns:
            val = data.at[r, c]
            # 勤休列のスタイル
            if c[0] == '勤(休)':
                styles.at[r, c] += 'font-weight: bold; background-color: #f9f9f9;'
                continue

            if val == '／':
                styles.at[r, c] += 'background-color: #ffcccc; color: black;'
            elif val == '×':
                styles.at[r, c] += 'background-color: #d9d9d9; color: gray;'
            elif val == '※':
                styles.at[r, c] += 'background-color: #ff0000; color: white; font-weight: bold;'
            elif val == 'A':
                styles.at[r, c] += 'background-color: #ccffff; color: black;'
            elif val == 'B':
                styles.at[r, c] += 'background-color: #ccffcc; color: black;'
            elif val == 'C':
                styles.at[r, c] += 'background-color: #ffffcc; color: black;'
            elif val == 'ネコ':
                styles.at[r, c] += 'background-color: #ffe5cc; color: black;'
            elif val == '〇':
                styles.at[r, c] += 'background-color: #e6e6fa; color: black;'

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
