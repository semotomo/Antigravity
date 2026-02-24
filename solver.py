# シフト生成ソルバー — シフト作成ツール

import random
import itertools
import numpy as np
import pandas as pd
import streamlit as st

from utils import (
    is_holiday,
    get_role_map_from_df,
    can_cover_required_roles,
    get_possible_day_patterns,
    assign_roles_smartly,
    DEFAULT_ROLES_CONFIG,
)


def solve_schedule_from_ui(staff_df, holidays_df, days_list, constraints, priority_days=None, required_work_df=None, roles_config=None):
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

    # --- リソース計算 ---
    req_offs_arr = req_offs

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
        day_patterns.append(pats)

    # --- ビームサーチ初期状態 ---
    current_paths = [{
        'sched': np.zeros((num_staff, num_days), dtype=int),
        'cons': initial_cons.copy(),
        'offs': np.zeros(num_staff, dtype=int),
        'off_cons': np.zeros(num_staff, dtype=int),
        'weekend_offs': np.zeros(num_staff, dtype=int),
        'score': 0
    }]

    # --- プログレスバー ---
    progress_bar = st.progress(0)
    status_text = st.empty()

    BEAM_WIDTH = 600  # パフォーマンスと品質のバランス

    # === メインループ：日ごとにビームサーチ ===
    for d in range(num_days):
        status_text.text(f"📊 {d+1}/{num_days} 日目を計算中... (候補数: {len(current_paths)})")
        progress_bar.progress((d + 1) / num_days)

        is_weekend = days_list[d].weekday() >= 5
        patterns = day_patterns[d]

        # パターンフィルタリング：有効/無効に分類
        valid_pats = [p for p in patterns if can_cover_required_roles(p, role_map, constraints, roles_config=roles_config)]
        invalid_pats = [p for p in patterns if not can_cover_required_roles(p, role_map, constraints, roles_config=roles_config)]
        use_patterns = valid_pats[:150] + invalid_pats[:150]
        if len(use_patterns) < 50:
            use_patterns = (valid_pats + invalid_pats)[:300]

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

                    penalty, violation = 0, False

                    # 役割カバーチェック
                    if not can_cover_required_roles(pat, role_map, constraints, roles_config=roles_config):
                        penalty += 50000

                    work_mask = np.zeros(num_staff, dtype=int)
                    for s in pat:
                        work_mask[s] = 1

                    # --- スタッフごとの制約チェック ---
                    for s in range(num_staff):
                        limit = max_cons_limits[s]
                        if work_mask[s] == 1:
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
                                if "Neko" in role_map[s] and "C" in role_map[s] and "A" not in role_map[s]:
                                    penalty += 200

                    if violation:
                        continue

                    days_left = num_days - 1 - d

                    # --- 公休数チェック ---
                    if strict_constraints:
                        if np.any(new_offs + days_left < req_offs):
                            continue
                    else:
                        if np.any(new_offs + days_left < req_offs):
                            penalty += 10000000

                    # --- 公休ペースペナルティ ---
                    expected = req_offs * ((d + 1) / num_days)
                    diff = new_offs - expected
                    penalty += np.sum(np.where(diff < 0, np.abs(diff) * 10000, np.abs(diff) * 2000))

                    # 月末の追い込みペナルティ
                    if days_left < 8:
                        penalty += np.sum(np.where(diff < 0, np.abs(diff) * 50000, 0))

                    # --- 動的リソース保全ペナルティ ---
                    worked_days = (d + 1) - new_offs
                    remaining_capacity = (num_days - req_offs_arr) - worked_days
                    total_remaining_capacity = np.sum(np.maximum(0, remaining_capacity))

                    min_needed = 0
                    for future_d_idx in range(d + 1, num_days):
                        future_t = daily_targets_list[future_d_idx]
                        needed_bodies = max(4, future_t['朝目標'] + future_t['夜目標'])
                        min_needed += needed_bodies

                    tightness = 0
                    if total_remaining_capacity > 0:
                        tightness = min_needed / total_remaining_capacity
                    else:
                        tightness = 2.0

                    # 適応的ペナルティ重み
                    surplus_penalty_weight = 500
                    if tightness > 0.9:
                        surplus_penalty_weight = 1000
                    if tightness > 1.0:
                        surplus_penalty_weight = 5000

                    # --- 優先曜日ロジック ---
                    current_wd_str = weekdays_jp[days_list[d].weekday()]
                    is_priority = current_wd_str in priority_days

                    if is_priority:
                        surplus_penalty_weight = 0
                    else:
                        if d >= 20:
                            surplus_penalty_weight = 10000

                    # --- 目標人数ペナルティ ---
                    day_target = daily_targets_list[d]
                    target_m = day_target['朝目標']
                    target_n = day_target['夜目標']

                    c_m = sum(1 for s in pat if "Morning" in role_map[s])
                    c_n = sum(1 for s in pat if "Night" in role_map[s])

                    if c_m < target_m:
                        penalty += (target_m - c_m) * 50
                    if c_n < target_n:
                        penalty += (target_n - c_n) * 50

                    target_total_bodies = max(4, target_m + target_n)
                    surplus_staff = max(0, len(pat) - target_total_bodies)
                    penalty += surplus_staff * surplus_penalty_weight

                    new_sched = path['sched'].copy()
                    new_sched[:, d] = work_mask

                    new_paths_local.append({
                        'sched': new_sched, 'cons': new_cons, 'offs': new_offs,
                        'off_cons': new_off_cons, 'weekend_offs': new_weekend_offs,
                        'score': path['score'] + penalty
                    })
            return new_paths_local

        # --- パス展開の実行 ---
        # 1. 厳密制約で試行
        next_paths = expand_paths(current_paths, use_patterns, strict_constraints=True)

        # 2. フォールバック：制約緩和
        if not next_paths:
            next_paths = expand_paths(current_paths, patterns[:300], strict_constraints=False)

        # 3. 最終フォールバック：全員休み
        if not next_paths:
            for path in current_paths:
                new_sched = path['sched'].copy()
                new_cons = np.zeros(num_staff, dtype=int)
                new_offs = path['offs'] + 1
                new_off_cons = path['off_cons'] + 1
                next_paths.append({
                    'sched': new_sched, 'cons': new_cons, 'offs': new_offs,
                    'off_cons': new_off_cons, 'weekend_offs': path['weekend_offs'],
                    'score': path['score'] + 1000000
                })

        next_paths.sort(key=lambda x: x['score'])
        current_paths = next_paths[:BEAM_WIDTH]

    # --- プログレスバークリア ---
    status_text.empty()
    progress_bar.empty()

    # === 結果のシフト表構築 ===
    best_path = current_paths[0]
    final_sched = best_path['sched']

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
        working = [s for s in range(num_staff) if final_sched[s, d] == 1]
        roles = assign_roles_smartly(working, role_map, roles_config=roles_config, staff_df=staff_df)
        is_insufficient = not can_cover_required_roles(working, role_map, constraints, roles_config=roles_config)

        for s in range(num_staff):
            if s in working:
                if s in roles:
                    output_data[s, d] = roles[s]
                else:
                    caps = role_map[s]
                    # 優先順位が低い役割から割り当て
                    fallback_role = '〇'
                    sorted_roles = sorted(roles_config, key=lambda r: r.get('priority', 999), reverse=True)
                    for role in sorted_roles:
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
