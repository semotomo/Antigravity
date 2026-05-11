# シフト生成ソルバー — シフト作成ツール

import random
import numpy as np
import pandas as pd

from flet_app.core.shift.utils import (
    is_holiday,
    get_role_map_from_df,
    can_cover_required_roles,
    get_possible_day_patterns,
    assign_roles_smartly,
    DEFAULT_ROLES_CONFIG,
)


def _select_beam_width(num_staff: int, num_days: int) -> int:
    """探索の広さを、月間シフトでも待ち時間が膨らみすぎない値へ調整する。"""
    complexity = max(1, num_staff) * max(1, num_days)
    if complexity >= 280:
        return 80
    if complexity >= 200:
        return 100
    if complexity >= 140:
        return 140
    if complexity >= 80:
        return 180
    return 220


def _select_pattern_limits(num_staff: int, num_days: int) -> tuple[int, int, int]:
    """候補パターン数を入力規模に合わせて抑え、体感速度を優先する。"""
    complexity = max(1, num_staff) * max(1, num_days)
    if complexity >= 280:
        return 32, 8, 64
    if complexity >= 200:
        return 40, 10, 80
    if complexity >= 140:
        return 56, 12, 100
    if complexity >= 80:
        return 72, 16, 120
    return 96, 24, 160


def solve_schedule_from_ui(
    staff_df,
    holidays_df,
    days_list,
    constraints,
    priority_days=None,
    required_work_df=None,
    roles_config=None,
    progress_callback=None,
):
    """
    メインソルバー：ビームサーチアルゴリズムでシフトを自動生成する。

    引数:
        staff_df: スタッフ情報DataFrame
        holidays_df: 休暇希望DataFrame
        days_list: 日付リスト
        constraints: 制約条件辞書
        priority_days: 優先曜日リスト
        required_work_df: 出勤指定DataFrame（Noneの場合は指定なし）
        roles_config: 役割設定リスト（Noneの場合はデフォルト4役割）
        progress_callback: 進行状況を報告するコールバック関数(current, total, message)

    戻り値:
        pd.DataFrame: 完成シフト表（Noneの場合は生成失敗）
    """
    if priority_days is None:
        priority_days = []
    if roles_config is None:
        roles_config = [dict(r) for r in DEFAULT_ROLES_CONFIG]

    # --- データ前処理 ---
    staff_df = staff_df.dropna(subset=['名前'])
    staff_df = staff_df[staff_df['名前'] != '']
    staff_df = staff_df.reset_index(drop=True)
    num_days = len(days_list)
    num_staff = len(staff_df)
    if num_staff == 0:
        return None

    weekdays_jp = ["月", "火", "水", "木", "金", "土", "日"]

    role_map = get_role_map_from_df(staff_df, roles_config=roles_config)

    # --- 初期パラメータ設定 ---
    col_prev_cons = "前月末の連勤数" if "前月末の連勤数" in staff_df.columns else "先月からの連勤"
    initial_cons = pd.to_numeric(staff_df[col_prev_cons], errors='coerce').fillna(0).astype(int).values
    req_offs = pd.to_numeric(staff_df['公休数'], errors='coerce').fillna(0).astype(int).values
    max_cons_limits = pd.to_numeric(staff_df['最大連勤'], errors='coerce').fillna(4).astype(int).values
    is_seishain = staff_df['正社員'].astype(bool).values

    # --- 固定シフト（希望休）の設定 ---
    fixed_shifts = np.full((num_staff, num_days), '', dtype=object)
    for d_idx in range(num_days):
        col_name = f"Day_{d_idx+1}"
        if col_name in holidays_df.columns:
            for s_idx in range(min(num_staff, len(holidays_df[col_name]))):
                if holidays_df[col_name].values[s_idx] in [True, '×']:
                    fixed_shifts[s_idx, d_idx] = '×'

    # --- 固定シフト（出勤指定）の設定 ---
    # 出勤指定は希望休より優先される（被った場合は '×' を上書き）
    required_work_flags = np.full((num_staff, num_days), False, dtype=bool)
    if required_work_df is not None:
        for d_idx in range(num_days):
            col_name = f"Day_{d_idx+1}"
            if col_name in required_work_df.columns:
                for s_idx in range(min(num_staff, len(required_work_df[col_name]))):
                    if required_work_df[col_name].values[s_idx] in [True, '★']:
                        required_work_flags[s_idx, d_idx] = True
                        # 出勤指定が優先：希望休を上書き
                        if fixed_shifts[s_idx, d_idx] == '×':
                            fixed_shifts[s_idx, d_idx] = ''

    # --- 制約パラメータ ---
    min_m = constraints.get('min_morning', 3)
    min_n = constraints.get('min_night', 3)

    # 曜日別目標人数の事前計算
    daily_targets_list = []
    for d in range(num_days):
        wd_str = weekdays_jp[days_list[d].weekday()]
        t = constraints.get('weekday_targets', {}).get(
            wd_str, {'朝目標': min_m, '夜目標': min_n}
        )
        daily_targets_list.append(t)

    weekday_names = [weekdays_jp[day.weekday()] for day in days_list]
    priority_day_set = set(priority_days)
    is_priority_day = [weekday in priority_day_set for weekday in weekday_names]
    is_weekend_day = [day.weekday() >= 5 for day in days_list]
    daily_body_targets = [max(4, target['朝目標'] + target['夜目標']) for target in daily_targets_list]
    future_needed_suffix = [0] * (num_days + 1)
    for idx in range(num_days - 1, -1, -1):
        future_needed_suffix[idx] = future_needed_suffix[idx + 1] + daily_body_targets[idx]

    req_offs = req_offs.tolist()
    initial_cons = initial_cons.tolist()
    max_cons_limits = max_cons_limits.tolist()
    is_seishain = is_seishain.tolist()
    morning_capable = [("Morning" in role_map[s]) for s in range(num_staff)]
    night_capable = [("Night" in role_map[s]) for s in range(num_staff)]
    special_rest_penalty_staff = [
        ("Neko" in role_map[s] and "C" in role_map[s] and "A" not in role_map[s])
        for s in range(num_staff)
    ]
    staff_indices = tuple(range(num_staff))

    # --- 日ごとの出勤パターン事前生成 ---
    day_patterns = []
    for d in range(num_days):
        avail = [s for s in range(num_staff) if fixed_shifts[s, d] != '×']
        # 出勤指定スタッフを必ず含むパターンのみにフィルタリング
        must_work = [s for s in range(num_staff) if required_work_flags[s, d]]
        pats = get_possible_day_patterns(avail, roles_config=roles_config)
        if must_work:
            pats = [p for p in pats if all(s in p for s in must_work)]
            # フィルタ後にパターンがない場合はフィルタなしにフォールバック
            if not pats:
                pats = get_possible_day_patterns(avail)
        random.shuffle(pats)

        pattern_infos = []
        for pat in pats:
            pat_tuple = tuple(pat)
            work_flags = tuple(s in pat_tuple for s in staff_indices)
            pattern_infos.append({
                'staff': pat_tuple,
                'work_flags': work_flags,
                'valid_roles': can_cover_required_roles(
                    pat_tuple,
                    role_map,
                    constraints,
                    roles_config=roles_config,
                ),
                'morning_count': sum(morning_capable[s] for s in pat_tuple),
                'night_count': sum(night_capable[s] for s in pat_tuple),
                'size': len(pat_tuple),
            })
        day_patterns.append(pattern_infos)

    # --- ビームサーチ初期状態 ---
    current_paths = [{
        'prev': None,
        'pattern': None,
        'cons': initial_cons.copy(),
        'offs': [0] * num_staff,
        'off_cons': [0] * num_staff,
        'weekend_offs': [0] * num_staff,
        'score': 0.0,
    }]

    # --- 進行状況コールバック ---
    if progress_callback:
        should_continue = progress_callback(0, num_days, "計算を開始します...")
        if should_continue is False:
            return None

    BEAM_WIDTH = _select_beam_width(num_staff, num_days)
    valid_pattern_limit, invalid_pattern_limit, fallback_pattern_limit = _select_pattern_limits(
        num_staff,
        num_days,
    )

    # === メインループ：日ごとにビームサーチ ===
    for d in range(num_days):
        if progress_callback:
            should_continue = progress_callback(d + 1, num_days, f"📊 {d+1}/{num_days} 日目を計算中... (候補数: {len(current_paths)})")
            if should_continue is False:
                return None

        is_weekend = is_weekend_day[d]
        is_priority = is_priority_day[d]
        patterns = day_patterns[d]
        day_target = daily_targets_list[d]
        target_m = day_target['朝目標']
        target_n = day_target['夜目標']
        target_total_bodies = daily_body_targets[d]
        days_left = num_days - 1 - d
        expected_ratio = (d + 1) / num_days
        future_min_needed = future_needed_suffix[d + 1]

        # パターンフィルタリング：有効/無効に分類
        valid_pats = [pattern for pattern in patterns if pattern['valid_roles']]
        invalid_pats = [pattern for pattern in patterns if not pattern['valid_roles']]
        use_patterns = valid_pats[:valid_pattern_limit] + invalid_pats[:invalid_pattern_limit]
        if len(use_patterns) < 50:
            use_patterns = (valid_pats + invalid_pats)[:fallback_pattern_limit]

        # --- パス展開関数 ---
        def expand_paths(paths, patterns_to_use, strict_constraints=True):
            """1日分のパスを展開し、スコア付きの新パスリストを返す"""
            new_paths_local = []
            for path in paths:
                for pat in patterns_to_use:
                    new_cons = path['cons'].copy()
                    new_offs = path['offs'].copy()
                    new_off_cons = path['off_cons'].copy()
                    new_weekend_offs = path['weekend_offs'].copy()

                    penalty = 0.0
                    violation = False

                    # 役割カバーチェック
                    if not pat['valid_roles']:
                        penalty += 50000

                    work_flags = pat['work_flags']

                    # --- スタッフごとの制約チェック ---
                    for s in staff_indices:
                        limit = max_cons_limits[s]
                        if work_flags[s]:
                            new_cons[s] += 1
                            new_off_cons[s] = 0
                            if new_cons[s] > limit:
                                if new_cons[s] == limit + 1:
                                    penalty += 1000
                                else:
                                    if strict_constraints:
                                        violation = True
                                        break
                                    else:
                                        penalty += 100000
                            elif new_cons[s] == limit:
                                penalty += 50
                        else:
                            new_cons[s] = 0
                            new_offs[s] += 1
                            new_off_cons[s] += 1
                            if is_weekend and is_seishain[s]:
                                if fixed_shifts[s, d] != '×':
                                    new_weekend_offs[s] += 1
                                    if new_weekend_offs[s] > 1:
                                        penalty += 20000
                            if new_off_cons[s] >= 3:
                                penalty += 100
                                if special_rest_penalty_staff[s]:
                                    penalty += 200

                    if violation:
                        continue

                    # --- 公休数チェック ---
                    missing_required_offs = False
                    if strict_constraints:
                        for s in staff_indices:
                            if new_offs[s] + days_left < req_offs[s]:
                                missing_required_offs = True
                                break
                        if missing_required_offs:
                            continue
                    else:
                        for s in staff_indices:
                            if new_offs[s] + days_left < req_offs[s]:
                                penalty += 10000000
                                break

                    # --- 公休ペースペナルティ ---
                    total_remaining_capacity = 0
                    for s in staff_indices:
                        expected = req_offs[s] * expected_ratio
                        diff = new_offs[s] - expected
                        if diff < 0:
                            penalty += (-diff) * 10000
                            if days_left < 8:
                                penalty += (-diff) * 50000
                        else:
                            penalty += diff * 2000

                        worked_days = (d + 1) - new_offs[s]
                        remaining_capacity = (num_days - req_offs[s]) - worked_days
                        if remaining_capacity > 0:
                            total_remaining_capacity += remaining_capacity

                    if total_remaining_capacity > 0:
                        tightness = future_min_needed / total_remaining_capacity
                    else:
                        tightness = 2.0

                    # 適応的ペナルティ重み
                    surplus_penalty_weight = 500
                    if tightness > 0.9:
                        surplus_penalty_weight = 1000
                    if tightness > 1.0:
                        surplus_penalty_weight = 5000

                    # --- 優先曜日ロジック ---
                    if is_priority:
                        surplus_penalty_weight = 0
                    else:
                        if d >= 20:
                            surplus_penalty_weight = 10000

                    # --- 目標人数ペナルティ ---
                    c_m = pat['morning_count']
                    c_n = pat['night_count']

                    if c_m < target_m:
                        penalty += (target_m - c_m) * 50
                    if c_n < target_n:
                        penalty += (target_n - c_n) * 50

                    surplus_staff = max(0, pat['size'] - target_total_bodies)
                    penalty += surplus_staff * surplus_penalty_weight

                    new_paths_local.append({
                        'prev': path,
                        'pattern': pat['staff'],
                        'cons': new_cons,
                        'offs': new_offs,
                        'off_cons': new_off_cons, 'weekend_offs': new_weekend_offs,
                        'score': path['score'] + penalty
                    })
            return new_paths_local

        # --- パス展開の実行 ---
        # 1. 厳密制約で試行
        next_paths = expand_paths(current_paths, use_patterns, strict_constraints=True)

        # 2. フォールバック：制約緩和
        if not next_paths:
            next_paths = expand_paths(current_paths, patterns[:fallback_pattern_limit], strict_constraints=False)

        # 3. 最終フォールバック：全員休み
        if not next_paths:
            for path in current_paths:
                new_cons = [0] * num_staff
                new_offs = [value + 1 for value in path['offs']]
                new_off_cons = [value + 1 for value in path['off_cons']]
                next_paths.append({
                    'prev': path,
                    'pattern': tuple(),
                    'cons': new_cons,
                    'offs': new_offs,
                    'off_cons': new_off_cons, 'weekend_offs': path['weekend_offs'],
                    'score': path['score'] + 1000000
                })

        next_paths.sort(key=lambda x: x['score'])
        current_paths = next_paths[:BEAM_WIDTH]

    # --- 進行状況コールバック完了 ---
    if progress_callback:
        progress_callback(num_days, num_days, "計算が完了しました。")

    # === 結果のシフト表構築 ===
    best_path = current_paths[0]
    selected_patterns = []
    while best_path and best_path['pattern'] is not None:
        selected_patterns.append(best_path['pattern'])
        best_path = best_path['prev']
    selected_patterns.reverse()
    sorted_roles_desc = sorted(roles_config, key=lambda r: r.get('priority', 999), reverse=True)

    # ヘッダー構築
    top_level = [str(d.day) for d in days_list] + ["勤(休)"]
    bottom_level = [
        "祝" if is_holiday(d) else weekdays_jp[d.weekday()]
        for d in days_list
    ] + [""]
    multi_cols = pd.MultiIndex.from_arrays([top_level, bottom_level])

    # データ格納
    output_data = np.full((num_staff + 1, num_days + 1), "", dtype=object)

    for d in range(num_days):
        working = list(selected_patterns[d]) if d < len(selected_patterns) else []
        working_set = set(working)
        roles = assign_roles_smartly(working, role_map, roles_config=roles_config, staff_df=staff_df)
        is_insufficient = not can_cover_required_roles(working, role_map, constraints, roles_config=roles_config)

        for s in staff_indices:
            if s in working_set:
                if s in roles:
                    output_data[s, d] = roles[s]
                else:
                    caps = role_map[s]
                    # 優先順位が低い役割から割り当て
                    fallback_role = '〇'
                    for role in sorted_roles_desc:
                        if role['name'] in caps:
                            fallback_role = role['name']
                            break
                    output_data[s, d] = fallback_role
            else:
                output_data[s, d] = '×' if fixed_shifts[s, d] == '×' else '／'
        if is_insufficient:
            output_data[num_staff, d] = "※"

    # 「勤(休)」列
    for s in range(num_staff):
        shifts = output_data[s, :num_days]
        off_count = sum(1 for x in shifts if x in ['／', '×'])
        work_count = num_days - off_count
        output_data[s, num_days] = f"{work_count}({off_count})"
    output_data[num_staff, num_days] = ""

    index_names = list(staff_df['名前']) + ["不足"]
    return pd.DataFrame(output_data, columns=multi_cols, index=index_names)
