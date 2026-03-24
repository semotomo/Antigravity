import json
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

import pandas as pd

from flet_app.components.shift_ui import normalize_staff_entry, staff_defaults_for_roles
from flet_app.core.shift.data_io import (
    delete_shift_history,
    get_default_data,
    load_settings_from_file,
    load_shift_history_detail,
    load_shift_history_list,
    save_shift_history,
)
from flet_app.core.shift.solver import (
    _select_beam_width,
    _select_pattern_limits,
    solve_schedule_from_ui,
)
from flet_app.pages.shift import ShiftState


class ShiftUiHelperTests(unittest.TestCase):
    def test_staff_defaults_include_dynamic_role_flags_and_numeric_defaults(self):
        defaults = staff_defaults_for_roles(["A", "B"])

        self.assertEqual(defaults["優先役割"], "なし")
        self.assertEqual(defaults["最大連勤"], 4)
        self.assertEqual(defaults["公休数"], 8)
        self.assertEqual(defaults["前月末の連勤数"], 0)
        self.assertFalse(defaults["A"])
        self.assertFalse(defaults["B"])

    def test_normalize_staff_entry_accepts_aliases_and_invalid_preferred_role(self):
        normalized = normalize_staff_entry(
            {
                "名前": "松本",
                "正社員": 1,
                "朝可": 0,
                "A": 1,
                "優先役割": "存在しない役割",
            },
            ["A", "B", "ネコ"],
        )

        self.assertEqual(normalized["name"], "松本")
        self.assertEqual(normalized["名前"], "松本")
        self.assertTrue(normalized["正社員"])
        self.assertFalse(normalized["朝可"])
        self.assertFalse(normalized["夜可"])
        self.assertEqual(normalized["優先役割"], "なし")
        self.assertTrue(normalized["A"])
        self.assertFalse(normalized["B"])
        self.assertFalse(normalized["ネコ"])


class ShiftDataIoCompatibilityTests(unittest.TestCase):
    def test_load_settings_from_file_backfills_new_staff_columns(self):
        temp_dir = Path("tests/.tmp")
        temp_dir.mkdir(parents=True, exist_ok=True)
        json_path = temp_dir / f"shift_{uuid4().hex}.json"
        payload = {
            "staff": {
                "名前": {"0": "西原"},
                "正社員": {"0": True},
                "朝可": {"0": True},
                "夜可": {"0": False},
                "A": {"0": True},
            },
            "holidays": {"Day_1": {"0": False}},
            "required_work": {"Day_1": {"0": False}},
            "date_range": {"start": "2026-03-01", "end": "2026-03-31"},
            "roles_config": [{"name": "A", "min_per_day": 1, "priority": 1}],
        }
        try:
            json_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            staff_df, holidays_df, required_work_df, _, _, _, _ = load_settings_from_file(
                str(json_path)
            )
        finally:
            json_path.unlink(missing_ok=True)

        self.assertEqual(staff_df.iloc[0]["優先役割"], "なし")
        self.assertEqual(staff_df.iloc[0]["公休数"], 8)
        self.assertEqual(staff_df.iloc[0]["前月末の連勤数"], 0)
        self.assertEqual(staff_df.iloc[0]["最大連勤"], 4)
        self.assertTrue(staff_df.iloc[0]["A"])
        self.assertIn("Day_1", holidays_df.columns)
        self.assertIn("Day_1", required_work_df.columns)


class ShiftStateDefaultTests(unittest.TestCase):
    def test_shift_state_defaults_to_three_people_and_weekends_priority(self):
        state = ShiftState()

        self.assertEqual(state.constraints["min_morning"], 3)
        self.assertEqual(state.constraints["min_night"], 3)
        self.assertEqual(state.priority_days, ["土", "日"])


class ShiftHistoryTests(unittest.TestCase):
    def test_shift_history_roundtrip(self):
        temp_dir = Path("tests/.tmp")
        temp_dir.mkdir(parents=True, exist_ok=True)

        result_df = pd.DataFrame(
            {
                ("14", "火"): {"西原": "A", "松本": "B"},
                ("勤(休)", ""): {"西原": "23(8)", "松本": "22(9)"},
            }
        )
        staff_df = pd.DataFrame({"名前": ["西原", "松本"]})

        with patch("flet_app.core.shift.data_io.HISTORY_DIR", str(temp_dir)):
            filepath = save_shift_history(
                result_df=result_df,
                staff_df=staff_df,
                start_date=pd.Timestamp("2026-03-01").date(),
                end_date=pd.Timestamp("2026-03-31").date(),
            )
            history_list = load_shift_history_list()
            loaded_df, history_meta = load_shift_history_detail(filepath)
            deleted = delete_shift_history(filepath)

        self.assertEqual(len(history_list), 1)
        self.assertTrue(filepath.endswith(".json"))
        self.assertEqual(history_meta["period"]["start"], "2026-03-01")
        self.assertEqual(history_meta["period"]["end"], "2026-03-31")
        self.assertEqual(list(loaded_df.index), ["西原", "松本"])
        self.assertEqual(loaded_df.iloc[0, 0], "A")
        self.assertTrue(deleted)


class ShiftSolverCancelTests(unittest.TestCase):
    def test_solver_returns_none_when_progress_callback_requests_cancel(self):
        staff_df, holidays_df, required_work_df = get_default_data()

        result = solve_schedule_from_ui(
            staff_df=staff_df,
            holidays_df=holidays_df,
            days_list=[pd.Timestamp("2026-03-01").date()],
            constraints={"min_morning": 3, "min_night": 3, "weekday_targets": {}},
            required_work_df=required_work_df,
            progress_callback=lambda current, total, message: False,
        )

        self.assertIsNone(result)


class ShiftSolverTuningTests(unittest.TestCase):
    def test_solver_uses_smaller_search_width_for_large_monthly_runs(self):
        self.assertLess(_select_beam_width(7, 31), _select_beam_width(7, 5))

    def test_solver_pattern_limits_are_capped_for_large_inputs(self):
        monthly_limits = _select_pattern_limits(7, 31)
        short_limits = _select_pattern_limits(7, 5)

        self.assertLess(monthly_limits[0], short_limits[0])
        self.assertLess(monthly_limits[2], short_limits[2])


if __name__ == "__main__":
    unittest.main()
