import flet as ft
import pandas as pd
from pathlib import Path
import asyncio
import copy
from flet_app.components.navigation import get_navigation_bar
from flet_app.core.auth_session import logout_page
from flet_app.core.shift.data_io import (
    list_stores, get_store_filepath,
    load_settings_from_file, save_settings_to_file, get_default_data, generate_custom_csv,
    save_shift_history, load_shift_history_list, load_shift_history_detail, delete_shift_history
)
from flet_app.core.shift.utils import DEFAULT_ROLES_CONFIG
from flet_app.core.shift.solver import solve_schedule_from_ui
from flet_app.components.shift_ui import (
    _add_staff,
    build_holidays_table,
    build_required_work_table,
    build_staff_table,
    normalize_staff_entry,
    staff_dataframe_columns,
)

from typing import Optional, Dict, Any, List
import datetime

class ShiftState:
    def __init__(self):
        self.stores = list_stores()
        self.current_store = self.stores[0] if self.stores else None
        default_role_names = [role["name"] for role in DEFAULT_ROLES_CONFIG]
        self.staff_df = pd.DataFrame(columns=staff_dataframe_columns(default_role_names))
        self.holidays_df = pd.DataFrame()
        self.required_work_df = pd.DataFrame()
        self.days_list: List[datetime.date] = []
        self.roles_config: List[Dict[str, Any]] = [dict(r) for r in DEFAULT_ROLES_CONFIG]
        self.start_d: Optional[datetime.date] = None
        self.end_d: Optional[datetime.date] = None
        self.constraints: Dict[str, Any] = {
            "min_morning": 3,
            "min_night": 3,
            "weekday_targets": {},
        }
        self.memos: Dict[str, str] = {}
        # shift_ui.py用のリストベース変数
        self.staff_list: List[Dict[str, Any]] = []
        self.holidays: Dict[str, Any] = {}
        self.required_work: Dict[str, Any] = {}
        self.dates: List[str] = []
        self.result_df: Optional[pd.DataFrame] = None
        self.selected_tab_index: int = 0
        self.pending_full_refresh: bool = True
        self.is_generating: bool = False
        self.generation_status: str = "まだシフトは生成していません。"
        self.priority_days: List[str] = ["土", "日"]
        self.cancel_generation_requested: bool = False
        self.history_entries: List[Dict[str, Any]] = []
        self.history_preview_df: Optional[pd.DataFrame] = None
        self.history_preview_label: str = ""
        self.history_preview_path: Optional[str] = None


def ShiftView(page: ft.Page):
    state = ShiftState()
    staff_defaults = {
        "優先役割": "なし",
        "正社員": False,
        "朝可": True,
        "夜可": False,
        "最大連勤": 4,
        "公休数": 8,
        "前月末の連勤数": 0,
    }

    def update_data_tables():
        pass

    def show_dialog(title: str, message: str):
        page.show_dialog(ft.AlertDialog(title=ft.Text(title), content=ft.Text(message)))

    def build_info_card(
        title: str,
        value: str,
        subtitle: str = "",
        accent: str = ft.Colors.BLUE_GREY_700,
        col: Any = 12,
    ):
        subtitle_control = ft.Text(subtitle, size=10, color=ft.Colors.BLUE_GREY_500) if subtitle else ft.Container(height=0)
        return ft.Card(
            elevation=0.25,
            col=col,
            content=ft.Container(
                content=ft.Column(
                    [
                        ft.Text(title, size=10, color=ft.Colors.BLUE_GREY_500),
                        ft.Text(value, size=17, weight=ft.FontWeight.W_600, color=accent),
                        subtitle_control,
                    ],
                    spacing=1,
                    tight=True,
                ),
                padding=ft.padding.symmetric(horizontal=10, vertical=8),
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=12,
                bgcolor=ft.Colors.WHITE,
            ),
        )

    def build_section_card(title: str, controls: list[ft.Control], subtitle: str = ""):
        header_controls: list[ft.Control] = [ft.Text(title, size=14, weight=ft.FontWeight.W_600)]
        if subtitle:
            header_controls.append(ft.Text(subtitle, size=10, color=ft.Colors.BLUE_GREY_500))
        header_controls.extend(controls)
        return ft.Card(
            elevation=0.25,
            content=ft.Container(
                content=ft.Column(header_controls, spacing=6, tight=True),
                padding=ft.padding.symmetric(horizontal=10, vertical=10),
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=14,
                bgcolor=ft.Colors.WHITE,
            ),
        )

    def compact_result_label(column: Any) -> str:
        if isinstance(column, tuple) and len(column) >= 2:
            return f"{column[0]}({column[1]})"
        return str(column)

    def result_cell_style(value: Any):
        palette = {
            "〇": (ft.Colors.DEEP_PURPLE_50, ft.Colors.DEEP_PURPLE_900),
            "／": (ft.Colors.RED_50, ft.Colors.RED_700),
            "×": (ft.Colors.GREY_200, ft.Colors.GREY_700),
            "※": (ft.Colors.PINK_300, ft.Colors.WHITE),
        }
        for role in state.roles_config:
            palette[role["name"]] = (role.get("color", ft.Colors.BLUE_50), role.get("text_color", ft.Colors.BLUE_GREY_900))
        return palette.get(str(value), (None, None))

    def build_result_table(result_df: Optional[pd.DataFrame] = None) -> ft.Control:
        display_df = result_df if result_df is not None else state.result_df
        if display_df is None:
            return ft.Container()

        day_width = 44
        name_width = 92
        summary_width = 60

        def header_container(label: str, width: int, bgcolor: str = ft.Colors.BLUE_GREY_50):
            return ft.Container(
                content=ft.Text(
                    label,
                    size=10,
                    weight=ft.FontWeight.W_600,
                    text_align=ft.TextAlign.CENTER,
                    max_lines=2,
                ),
                width=width,
                height=44,
                alignment=ft.Alignment(0, 0),
                padding=ft.padding.symmetric(horizontal=3, vertical=2),
                bgcolor=bgcolor,
                border_radius=9,
            )

        def data_container(label: str, width: int, bgcolor: str | None = None, color: str | None = None):
            return ft.Container(
                content=ft.Text(
                    label,
                    size=11,
                    color=color,
                    weight=ft.FontWeight.W_500 if bgcolor else ft.FontWeight.W_400,
                    text_align=ft.TextAlign.CENTER,
                ),
                width=width,
                height=44,
                alignment=ft.Alignment(0, 0),
                padding=ft.padding.symmetric(horizontal=2, vertical=1),
                bgcolor=bgcolor,
                border_radius=9 if bgcolor else 0,
            )

        columns = [ft.DataColumn(header_container("名前", name_width))]
        for column in display_df.columns:
            label = compact_result_label(column)
            width = summary_width if "勤(休)" in label else day_width
            header_bg = ft.Colors.BLUE_GREY_50
            if "土" in label:
                header_bg = ft.Colors.LIGHT_BLUE_50
            elif "日" in label or "祝" in label:
                header_bg = ft.Colors.RED_50
            columns.append(ft.DataColumn(header_container(label, width, header_bg)))

        rows: list[ft.DataRow] = []
        for staff_name, row in display_df.iterrows():
            cells = [
                ft.DataCell(
                    ft.Container(
                        content=ft.Text(str(staff_name), size=12, weight=ft.FontWeight.W_600),
                        width=name_width,
                        height=44,
                        alignment=ft.Alignment(-1, 0),
                        padding=ft.padding.symmetric(horizontal=6, vertical=1),
                    )
                )
            ]
            for column in display_df.columns:
                label = compact_result_label(column)
                width = summary_width if "勤(休)" in label else day_width
                bgcolor, color = result_cell_style(row[column])
                cells.append(ft.DataCell(data_container(str(row[column]), width, bgcolor, color)))
            rows.append(ft.DataRow(cells=cells))

        return ft.DataTable(
            columns=columns,
            rows=rows,
            column_spacing=4,
            horizontal_margin=4,
            heading_row_height=48,
            data_row_min_height=46,
            data_row_max_height=46,
            divider_thickness=0.5,
            heading_row_color=ft.Colors.TRANSPARENT,
            border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
            border_radius=14,
            data_text_style=ft.TextStyle(size=11),
            bgcolor=ft.Colors.WHITE,
        )

    def on_ui_change(force_full_refresh: bool = False, sync_dataframes: bool = True):
        if sync_dataframes:
            sync_ui_state_to_dataframes()
        full_refresh = force_full_refresh or state.selected_tab_index != 0
        if not full_refresh:
            state.pending_full_refresh = True
        update_data_tables(full_refresh=full_refresh)
        page.update()

    def on_priority_day_select(day_name: str, selected: bool):
        ordered_days = ["月", "火", "水", "木", "金", "土", "日"]
        current = set(state.priority_days)
        if selected:
            current.add(day_name)
        else:
            current.discard(day_name)
        state.priority_days = [day for day in ordered_days if day in current]
        state.pending_full_refresh = True
        update_data_tables(full_refresh=False)
        page.update()

    def get_valid_staff_names() -> list[str]:
        if state.staff_df is None or "名前" not in state.staff_df.columns:
            return []
        return [str(name).strip() for name in state.staff_df["名前"].dropna().tolist() if str(name).strip()]

    def refresh_history_entries() -> None:
        state.history_entries = load_shift_history_list()

    def clear_history_preview(e=None) -> None:
        state.history_preview_df = None
        state.history_preview_label = ""
        state.history_preview_path = None
        tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
        page.update()

    def open_history_entry(filepath: str, period: dict[str, Any]) -> None:
        try:
            history_df, _ = load_shift_history_detail(filepath)
            state.history_preview_df = history_df
            state.history_preview_label = f"{period.get('start', '?')} 〜 {period.get('end', '?')} の履歴"
            state.history_preview_path = filepath
            tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
            page.update()
        except Exception as ex:
            show_dialog("履歴エラー", f"履歴の読み込みに失敗しました:\n{ex}")

    def remove_history_entry(filepath: str) -> None:
        if delete_shift_history(filepath):
            if state.history_preview_path == filepath:
                state.history_preview_df = None
                state.history_preview_label = ""
                state.history_preview_path = None
            refresh_history_entries()
            tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
            page.update()
        else:
            show_dialog("削除失敗", "履歴を削除できませんでした。")

    async def confirm_navigation_while_generating(target_route: str) -> bool:
        if not state.is_generating:
            return True

        loop = asyncio.get_running_loop()
        decision: asyncio.Future[bool] = loop.create_future()

        def close_dialog(allow_move: bool, cancel_generation: bool = False):
            if cancel_generation:
                state.cancel_generation_requested = True
                state.generation_status = "シフト生成をキャンセルしています。数秒後に停止します。"
            page.pop_dialog()
            if not decision.done():
                decision.set_result(allow_move)
            if getattr(page, "route", "") == "/shift":
                tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                page.update()

        dialog = ft.AlertDialog(
            modal=True,
            title=ft.Text("シフト生成中です"),
            content=ft.Text("移動すると結果表示は消えますが、完了した生成結果は履歴から確認できます。"),
            actions=[
                ft.TextButton("この画面に残る", on_click=lambda e: close_dialog(False)),
                ft.TextButton("生成を続けて移動", on_click=lambda e: close_dialog(True)),
                ft.FilledButton("キャンセルして移動", on_click=lambda e: close_dialog(True, True)),
            ],
            actions_alignment=ft.MainAxisAlignment.END,
        )
        page.show_dialog(dialog)
        return await decision

    def build_generation_tab_controls(valid_staff_count: int) -> list[ft.Control]:
        refresh_history_entries()
        generate_btn = ft.ElevatedButton(
            "シフト自動生成",
            icon=ft.Icons.AUTO_AWESOME,
            on_click=generate_shift,
            width=200,
            height=46,
            disabled=state.is_generating,
        )
        generation_feedback = ft.Row(
            [
                ft.ProgressRing(width=18, height=18, stroke_width=2),
                ft.Text(state.generation_status, size=12),
            ],
            spacing=10,
            visible=state.is_generating,
        )
        controls: list[ft.Control] = [
            ft.ResponsiveRow(
                [
                    build_info_card("対象期間", f"{len(state.days_list)}日", subtitle="今回生成するシフト日数", accent=ft.Colors.BLUE_800, col={"xs": 12, "sm": 4}),
                    build_info_card("スタッフ", f"{valid_staff_count}人", subtitle="有効なスタッフ数", accent=ft.Colors.TEAL_700, col={"xs": 12, "sm": 4}),
                    build_info_card("優先曜日", "・".join(state.priority_days) if state.priority_days else "未設定", subtitle="余剰人数を寄せやすい曜日", accent=ft.Colors.ORANGE_800, col={"xs": 12, "sm": 4}),
                ],
                spacing={"xs": 8, "md": 10},
                run_spacing=8,
            ),
            build_section_card(
                "シフト生成",
                [
                    ft.Text("ボタンを押すと先に状態表示を更新してから計算を始めます。", size=11, color=ft.Colors.BLUE_GREY_500),
                    ft.Row([generate_btn], spacing=8),
                    generation_feedback,
                    ft.Text(state.generation_status, size=12, visible=not state.is_generating),
                ],
            ),
        ]

        if state.history_entries:
            history_rows: list[ft.Control] = []
            for entry in state.history_entries[:8]:
                period = entry.get("period", {})
                period_label = f"{period.get('start', '?')} 〜 {period.get('end', '?')}"
                history_rows.append(
                    ft.Container(
                        content=ft.ResponsiveRow(
                            [
                                ft.Container(
                                    content=ft.Column(
                                        [
                                            ft.Text(period_label, size=12, weight=ft.FontWeight.W_600),
                                            ft.Text(
                                                f"{entry.get('staff_count', 0)}人 / 作成 {str(entry.get('created_at', ''))[:16].replace('T', ' ')}",
                                                size=11,
                                                color=ft.Colors.BLUE_GREY_500,
                                            ),
                                        ],
                                        spacing=2,
                                        tight=True,
                                    ),
                                    col={"xs": 12, "sm": 8},
                                ),
                                ft.Container(
                                    content=ft.Row(
                                        [
                                            ft.TextButton("閲覧", on_click=lambda e, p=entry["filepath"], per=period: open_history_entry(p, per)),
                                            ft.IconButton(ft.Icons.DELETE_OUTLINE, tooltip="履歴を削除", on_click=lambda e, p=entry["filepath"]: remove_history_entry(p)),
                                        ],
                                        alignment=ft.MainAxisAlignment.END,
                                        spacing=4,
                                    ),
                                    col={"xs": 12, "sm": 4},
                                ),
                            ],
                            spacing=6,
                            run_spacing=4,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        padding=ft.padding.symmetric(horizontal=10, vertical=8),
                        border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                        border_radius=12,
                        bgcolor=ft.Colors.BLUE_GREY_50,
                    )
                )

            controls.append(
                build_section_card(
                    "生成履歴",
                    [
                        ft.Text("移動後に完了したシフトも、ここから開いて確認できます。", size=11, color=ft.Colors.BLUE_GREY_500),
                        *history_rows,
                    ],
                )
            )
        else:
            controls.append(
                build_section_card(
                    "生成履歴",
                    [ft.Text("履歴はまだありません。生成が完了すると自動で保存されます。", size=11, color=ft.Colors.BLUE_GREY_500)],
                )
            )

        display_df = state.history_preview_df if state.history_preview_df is not None else state.result_df
        display_title = state.history_preview_label if state.history_preview_df is not None else "生成結果"

        if display_df is not None:
            result_table = build_result_table(display_df)
            csv_btn = ft.ElevatedButton(
                "CSVで保存",
                icon=ft.Icons.DOWNLOAD,
                on_click=save_result_csv,
                visible=state.history_preview_df is None,
            )
            controls.append(
                build_section_card(
                    display_title,
                    [
                        ft.Row(
                            [
                                csv_btn,
                                ft.TextButton("最新の生成結果に戻る", on_click=clear_history_preview, visible=state.history_preview_df is not None),
                            ],
                            alignment=ft.MainAxisAlignment.START,
                        ),
                        ft.Text("余白を詰めた表示にしているので、横幅が狭い画面でも見やすくなります。", size=11, color=ft.Colors.BLUE_GREY_500),
                        ft.Row([result_table], scroll=ft.ScrollMode.AUTO),
                    ],
                )
            )
        return controls

    def normalize_selected_date(event):
        raw_value = getattr(event, "data", None)
        if raw_value:
            raw_text = str(raw_value).strip()
            try:
                if "T" in raw_text or " " in raw_text or raw_text.endswith("Z") or "+" in raw_text[10:]:
                    return datetime.datetime.fromisoformat(raw_text.replace("Z", "+00:00")).astimezone().date()
                return datetime.date.fromisoformat(raw_text)
            except ValueError:
                pass

        value = getattr(event.control, "value", None)
        return value.date() if hasattr(value, "date") else value

    def refresh_days_list():
        if (
            isinstance(state.start_d, datetime.date)
            and isinstance(state.end_d, datetime.date)
            and state.start_d <= state.end_d
        ):
            state.days_list = [
                state.start_d + datetime.timedelta(days=i)
                for i in range((state.end_d - state.start_d).days + 1)
            ]
        else:
            state.days_list = []

    def on_start_date_change(e):
        selected = normalize_selected_date(e)
        if not isinstance(selected, datetime.date):
            return
        state.start_d = selected
        if isinstance(state.end_d, datetime.date) and state.end_d < state.start_d:
            state.end_d = state.start_d
        refresh_days_list()
        on_ui_change(sync_dataframes=False)

    def on_end_date_change(e):
        selected = normalize_selected_date(e)
        if not isinstance(selected, datetime.date):
            return
        state.end_d = selected
        if isinstance(state.start_d, datetime.date) and state.end_d < state.start_d:
            state.end_d = state.start_d
        refresh_days_list()
        on_ui_change(sync_dataframes=False)

    def open_start_date_picker(e=None):
        picker = ft.DatePicker(
            value=state.start_d or datetime.date.today(),
            on_change=on_start_date_change,
        )
        page.show_dialog(picker)

    def open_end_date_picker(e=None):
        default_end = state.end_d or state.start_d or (datetime.date.today() + datetime.timedelta(days=30))
        picker = ft.DatePicker(
            value=default_end,
            on_change=on_end_date_change,
        )
        page.show_dialog(picker)

    def apply_default_shift_data():
        staff_df, holidays_df, required_work_df = get_default_data(state.roles_config)
        state.staff_df = staff_df
        state.holidays_df = holidays_df
        state.required_work_df = required_work_df

    def sync_ui_state_to_dataframes():
        role_names = [role["name"] for role in state.roles_config]
        existing_columns = list(state.staff_df.columns) if state.staff_df is not None else []
        base_columns = staff_dataframe_columns(role_names, existing_columns)
        existing_rows = (
            [normalize_staff_entry(row, role_names) for row in state.staff_df.to_dict("records")]
            if state.staff_df is not None and not state.staff_df.empty
            else []
        )
        staff_rows = []

        for idx, staff in enumerate(state.staff_list):
            normalized_staff = normalize_staff_entry(staff, role_names)
            source_row = existing_rows[idx] if idx < len(existing_rows) else {}
            row = {}
            for column in base_columns:
                if column in normalized_staff:
                    row[column] = normalized_staff[column]
                elif column in source_row:
                    row[column] = source_row[column]
                elif column in staff_defaults:
                    row[column] = staff_defaults[column]
                elif column in role_names:
                    row[column] = False
                else:
                    row[column] = ""
            row["名前"] = normalized_staff["名前"]
            staff_rows.append(row)

        state.staff_df = pd.DataFrame(staff_rows, columns=base_columns)

        day_columns = [f"Day_{i+1}" for i in range(len(state.dates))]
        holiday_rows = []
        required_rows = []
        for staff in state.staff_list:
            normalized_staff = normalize_staff_entry(staff, role_names)
            name = normalized_staff["名前"]
            holiday_row = {"名前": name}
            required_row = {"名前": name}
            selected_holidays = set(state.holidays.get(name, []))
            selected_required = set(state.required_work.get(name, []))

            for idx, date_label in enumerate(state.dates):
                column = day_columns[idx]
                holiday_row[column] = date_label in selected_holidays
                required_row[column] = date_label in selected_required

            holiday_rows.append(holiday_row)
            required_rows.append(required_row)

        holiday_columns = ["名前", *day_columns]
        state.holidays_df = pd.DataFrame(holiday_rows, columns=holiday_columns)
        state.required_work_df = pd.DataFrame(required_rows, columns=holiday_columns)

    # --- 状態読込 ---
    def load_store_data(store_name):
        if not store_name:
            return
        filepath = get_store_filepath(store_name)
        result = load_settings_from_file(filepath)
        if result:
            (staff_df, holidays_df, required_work_df,
             memos, start_d, end_d, roles_config) = result
            # None チェック：ファイルが空または破損している場合はデフォルトを維持
            import datetime
            if isinstance(start_d, datetime.date) and isinstance(end_d, datetime.date):
                state.start_d = start_d
                state.end_d = end_d
                d0 = start_d
                d1 = end_d
                state.days_list = [
                    d0 + datetime.timedelta(days=i)
                    for i in range((d1 - d0).days + 1)
                ]
            else:
                d0 = datetime.date.today()
                d1 = d0 + datetime.timedelta(days=30)
                state.start_d = d0
                state.end_d = d1
                state.days_list = [
                    d0 + datetime.timedelta(days=i)
                    for i in range((d1 - d0).days + 1)
                ]
            if staff_df is not None:
                state.staff_df = staff_df
            if holidays_df is not None:
                state.holidays_df = holidays_df
            if required_work_df is not None:
                state.required_work_df = required_work_df
            if memos is not None:
                state.memos = memos
            if roles_config is not None:
                state.roles_config = roles_config
        if state.staff_df is None or state.staff_df.empty:
            apply_default_shift_data()
        state.pending_full_refresh = True
        update_data_tables(full_refresh=True)

    # --- ログアウト ---
    async def logout_clicked(e):
        if not await confirm_navigation_while_generating("/login"):
            return
        await logout_page(page)
        if hasattr(page, "push_route"):
            await page.push_route("/login")
        else:
            page.go("/login")

    # --- 保存 ---
    def save_clicked(e):
        if not state.current_store:
            show_dialog("エラー", "店舗が選択されていません")
            return
        filepath = get_store_filepath(state.current_store)
        try:
            sync_ui_state_to_dataframes()
            save_settings_to_file(
                filepath=filepath,
                staff_df=state.staff_df,
                holidays_df=state.holidays_df,
                required_work_df=state.required_work_df,
                memos=state.memos,
                start_date=state.start_d,
                end_date=state.end_d,
                roles_config=state.roles_config,
            )
            show_dialog("保存完了", "設定を保存しました")
        except Exception as ex:
            show_dialog("保存失敗", str(ex))

    # --- 店舗切替 ---
    def on_store_change(e):
        state.current_store = str(e.control.value)
        load_store_data(state.current_store)
        page.update()

    # --- シフト自動生成 ---
    async def run_shift_generation():
        try:
            await asyncio.sleep(0)
            sync_ui_state_to_dataframes()
            if state.staff_df.empty or not state.days_list:
                state.generation_status = "スタッフ情報または日付が設定されていません。"
                if getattr(page, "route", "") == "/shift":
                    tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                    page.update()
                    show_dialog("エラー", "スタッフ情報または日付が設定されていません")
                return

            staff_df_snapshot = state.staff_df.copy(deep=True)
            holidays_df_snapshot = state.holidays_df.copy(deep=True)
            required_work_df_snapshot = state.required_work_df.copy(deep=True)
            days_list_snapshot = list(state.days_list)
            constraints_snapshot = copy.deepcopy(state.constraints)
            priority_days_snapshot = list(state.priority_days)
            roles_config_snapshot = copy.deepcopy(state.roles_config)

            res_df = await asyncio.to_thread(
                solve_schedule_from_ui,
                staff_df=staff_df_snapshot,
                holidays_df=holidays_df_snapshot,
                days_list=days_list_snapshot,
                constraints=constraints_snapshot,
                priority_days=priority_days_snapshot,
                required_work_df=required_work_df_snapshot,
                roles_config=roles_config_snapshot,
                progress_callback=lambda current, total, message: not state.cancel_generation_requested,
            )
            if state.cancel_generation_requested:
                state.generation_status = "シフト生成をキャンセルしました。"
                state.cancel_generation_requested = False
                if getattr(page, "route", "") == "/shift":
                    tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                    page.update()
                return

            if res_df is not None:
                state.result_df = res_df
                state.history_preview_df = None
                state.history_preview_label = ""
                state.history_preview_path = None
                history_path = save_shift_history(res_df, state.staff_df, state.start_d, state.end_d)
                setattr(page, "shift_last_history_path", history_path)
                state.generation_status = f"{len(state.days_list)}日分のシフト生成が完了しました。履歴へ保存しました。"
                if getattr(page, "route", "") == "/shift":
                    tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                    page.update()
                    show_dialog("生成完了", "シフトを自動生成しました。履歴にも保存しています。")
            else:
                state.generation_status = "シフトの自動生成に失敗しました。条件やスタッフ設定を確認してください。"
                if getattr(page, "route", "") == "/shift":
                    tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                    page.update()
                    show_dialog("失敗", "シフトの自動生成に失敗しました")
        except Exception as ex:
            state.generation_status = f"エラーで生成が止まりました: {ex}"
            if getattr(page, "route", "") == "/shift":
                tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                page.update()
                show_dialog("エラー", str(ex))
        finally:
            state.is_generating = False
            if getattr(page, "route", "") == "/shift":
                tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
                page.update()

    def generate_shift(e):
        has_staff = bool(state.staff_list) or (state.staff_df is not None and not state.staff_df.empty)
        if not has_staff or not state.days_list:
            show_dialog("エラー", "スタッフ情報または日付が設定されていません")
            return
        if state.is_generating:
            return

        state.is_generating = True
        state.cancel_generation_requested = False
        state.generation_status = "シフトを自動生成しています。数秒から十数秒かかる場合があります。"
        tab3_content.controls = build_generation_tab_controls(len(get_valid_staff_names()))
        page.update()
        page.run_task(run_shift_generation)

    async def save_result_csv(e):
        if state.result_df is None:
            show_dialog("エラー", "保存するシフト結果がありません")
            return

        csv_bytes = generate_custom_csv(state.result_df, state.staff_df, state.days_list)
        picker = ft.FilePicker()

        try:
            save_path = await picker.save_file(
                dialog_title="シフトを保存",
                file_name="shift_result.csv",
                file_type=ft.FilePickerFileType.CUSTOM,
                allowed_extensions=["csv"],
                src_bytes=csv_bytes,
            )

            is_web = bool(getattr(page, "web", False))
            is_mobile = bool(
                hasattr(page, "platform")
                and hasattr(page.platform, "is_mobile")
                and page.platform.is_mobile()
            )

            if is_web or is_mobile:
                show_dialog("保存完了", "CSVを保存しました")
                return

            if save_path:
                Path(save_path).write_bytes(csv_bytes)
                show_dialog("保存完了", f"CSVを保存しました: {save_path}")
            else:
                show_dialog("保存キャンセル", "CSV保存をキャンセルしました")
        except Exception as ex:
            show_dialog("エラー", f"CSV保存に失敗しました:\n{ex}")

    # --- DataTable: スタッフ ---
    tab1_content = ft.Column([ft.Text("基本設定画面（実装予定）")], scroll=ft.ScrollMode.AUTO, expand=True)
    tab2_content = ft.Column([ft.Text("スタッフ＆休日設定（読込中...）")], scroll=ft.ScrollMode.AUTO, expand=True)
    tab3_content = ft.Column([ft.Text("シフト生成画面（読込中...）")], scroll=ft.ScrollMode.AUTO, expand=True)

    def wrap_scrollable_table(control: ft.Control) -> ft.Control:
        return ft.Row([control], scroll=ft.ScrollMode.AUTO)

    def update_data_tables(full_refresh: bool = True):
        str_start_d = state.start_d.strftime('%Y/%m/%d') if isinstance(state.start_d, datetime.date) else '未設定'
        compact_button_style = ft.ButtonStyle(
            padding=ft.padding.symmetric(horizontal=12, vertical=0),
            shape=ft.RoundedRectangleBorder(radius=12),
        )
        start_btn = ft.OutlinedButton(
            f"開始日: {str_start_d}",
            icon=ft.Icons.CALENDAR_MONTH,
            height=38,
            style=compact_button_style,
            on_click=open_start_date_picker,
        )
        str_end_d = state.end_d.strftime('%Y/%m/%d') if isinstance(state.end_d, datetime.date) else '未設定'
        end_btn = ft.OutlinedButton(
            f"終了日: {str_end_d}",
            icon=ft.Icons.CALENDAR_MONTH,
            height=38,
            style=compact_button_style,
            on_click=open_end_date_picker,
        )

        def on_constraint_change(e, key):
            try:
                state.constraints[key] = int(e.control.value)
            except ValueError:
                pass

        min_morning_input = ft.TextField(
            label="朝の最低人数", value=str(state.constraints.get("min_morning", 2)),
            width=140,
            dense=True,
            height=40,
            text_size=13,
            content_padding=ft.padding.symmetric(horizontal=10, vertical=8),
            on_change=lambda e: on_constraint_change(e, "min_morning"),
        )
        min_night_input = ft.TextField(
            label="夜の最低人数", value=str(state.constraints.get("min_night", 2)),
            width=140,
            dense=True,
            height=40,
            text_size=13,
            content_padding=ft.padding.symmetric(horizontal=10, vertical=8),
            on_change=lambda e: on_constraint_change(e, "min_night"),
        )

        # 曜日別目標
        weekdays = ["月", "火", "水", "木", "金", "土", "日"]
        weekday_rows = []
        for wd in weekdays:
            wt = state.constraints.get("weekday_targets", {}).get(wd, {"朝目標": state.constraints.get("min_morning", 2), "夜目標": state.constraints.get("min_night", 2)})
            
            def make_target_updater(day_name, is_morning):
                def updater(e):
                    if day_name not in state.constraints["weekday_targets"]:
                        state.constraints["weekday_targets"][day_name] = {"朝目標": state.constraints.get("min_morning", 2), "夜目標": state.constraints.get("min_night", 2)}
                    try:
                        if is_morning:
                            state.constraints["weekday_targets"][day_name]["朝目標"] = int(e.control.value)
                        else:
                            state.constraints["weekday_targets"][day_name]["夜目標"] = int(e.control.value)
                    except ValueError:
                        pass
                return updater

            row = ft.Container(
                col={"xs": 6, "sm": 4, "md": 3, "lg": 2},
                content=ft.Container(
                    content=ft.Column([
                        ft.Text(f"{wd}曜", size=11, weight=ft.FontWeight.W_600),
                        ft.TextField(
                            label="朝",
                            value=str(wt.get("朝目標", 2)),
                            dense=True,
                            height=38,
                            text_size=12,
                            content_padding=ft.padding.symmetric(horizontal=8, vertical=6),
                            on_change=make_target_updater(wd, True),
                        ),
                        ft.TextField(
                            label="夜",
                            value=str(wt.get("夜目標", 2)),
                            dense=True,
                            height=38,
                            text_size=12,
                            content_padding=ft.padding.symmetric(horizontal=8, vertical=6),
                            on_change=make_target_updater(wd, False),
                        ),
                    ], spacing=4, tight=True),
                    padding=ft.padding.symmetric(horizontal=8, vertical=8),
                    border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                    border_radius=12,
                    bgcolor=ft.Colors.BLUE_GREY_50,
                ),
            )
            weekday_rows.append(row)

        priority_day_chips = [
            ft.Chip(
                label=day,
                selected=day in state.priority_days,
                bgcolor=ft.Colors.WHITE,
                selected_color=ft.Colors.BLUE_50,
                border_side=ft.border.BorderSide(1, ft.Colors.BLUE_GREY_200),
                label_text_style=ft.TextStyle(size=11),
                on_select=lambda e, d=day: on_priority_day_select(d, bool(e.control.selected)),
                col={"xs": 3, "sm": 2, "md": 2, "lg": 1},
            )
            for day in weekdays
        ]

        # タブ1: 基本設定
        tab1_content.controls = [
            ft.Text("■ シフト期間", weight=ft.FontWeight.BOLD),
            ft.Row([start_btn, ft.Text(" 〜 "), end_btn]),
            ft.Divider(height=20),
            ft.Text("■ 最低人数設定", weight=ft.FontWeight.BOLD),
            ft.Row([min_morning_input, min_night_input]),
            ft.Divider(height=20),
            ft.Text("■ 曜日別 目標人数", weight=ft.FontWeight.BOLD),
            *weekday_rows
        ]

        tab1_content.controls = [
            ft.ResponsiveRow(
                [
                    build_info_card(
                        "対象期間",
                        f"{len(state.days_list)}日" if state.days_list else "未設定",
                        subtitle=f"{state.start_d.strftime('%m/%d')} - {state.end_d.strftime('%m/%d')}" if state.start_d and state.end_d else "",
                        accent=ft.Colors.BLUE_800,
                        col={"xs": 12, "sm": 6, "md": 4},
                    ),
                    build_info_card(
                        "最低人数",
                        f"朝 {state.constraints.get('min_morning', 2)} / 夜 {state.constraints.get('min_night', 2)}",
                        subtitle="毎日必ず確保したい人数",
                        accent=ft.Colors.TEAL_700,
                        col={"xs": 12, "sm": 6, "md": 4},
                    ),
                    build_info_card(
                        "優先曜日",
                        "・".join(state.priority_days) if state.priority_days else "未設定",
                        subtitle="余剰人数を置きやすい曜日",
                        accent=ft.Colors.ORANGE_800,
                        col={"xs": 12, "sm": 12, "md": 4},
                    ),
                ],
                spacing={"xs": 8, "md": 10},
                run_spacing=8,
            ),
            build_section_card(
                "シフト期間",
                [
                    ft.ResponsiveRow(
                        [
                            ft.Container(content=start_btn, col={"xs": 12, "sm": 6}),
                            ft.Container(content=end_btn, col={"xs": 12, "sm": 6}),
                        ],
                        spacing=8,
                        run_spacing=8,
                    )
                ],
            ),
            build_section_card(
                "人数と優先曜日",
                [
                    ft.ResponsiveRow(
                        [
                            ft.Container(content=min_morning_input, col={"xs": 12, "sm": 6, "md": 4}),
                            ft.Container(content=min_night_input, col={"xs": 12, "sm": 6, "md": 4}),
                        ],
                        spacing=8,
                        run_spacing=8,
                    ),
                    ft.Text("優先曜日", size=12, weight=ft.FontWeight.W_600),
                    ft.Text("余剰人数が出る場合、この曜日に寄せやすくします。", size=11, color=ft.Colors.BLUE_GREY_500),
                    ft.ResponsiveRow(priority_day_chips, spacing=6, run_spacing=6),
                ],
            ),
            build_section_card(
                "曜日別 目標人数",
                [ft.ResponsiveRow(weekday_rows, spacing=8, run_spacing=8)],
                subtitle="最低人数は守りつつ、ここで指定した人数にできるだけ近づけます。",
            ),
        ]

        if not full_refresh:
            return

        # タブ2: スタッフ＆休日設定
        if state.days_list:
            state.dates = [d.strftime("%m/%d") for d in state.days_list]
        else:
            state.dates = []

        if state.staff_df is None or state.staff_df.empty:
            state.staff_list = []
        else:
            role_names = [role["name"] for role in state.roles_config]
            state.staff_list = [
                normalize_staff_entry(record, role_names)
                for record in state.staff_df.to_dict("records")
            ]
        
        # DataFrame から key-value 保存用に変換 (shift_uiの要件に合わせる)
        if state.holidays_df is not None and not state.holidays_df.empty:
            state.holidays = {}
            for idx, row in state.holidays_df.iterrows():
                name = row.get("名前", "")
                if name:
                    state.holidays[name] = [
                        state.dates[i]
                        for i in range(len(state.dates))
                        if f"Day_{i+1}" in state.holidays_df.columns and bool(row.get(f"Day_{i+1}", False))
                    ]
        else:
            state.holidays = {}

        if state.required_work_df is not None and not state.required_work_df.empty:
            state.required_work = {}
            for idx, row in state.required_work_df.iterrows():
                name = row.get("名前", "")
                if name:
                    state.required_work[name] = [
                        state.dates[i]
                        for i in range(len(state.dates))
                        if f"Day_{i+1}" in state.required_work_df.columns and bool(row.get(f"Day_{i+1}", False))
                    ]
        else:
            state.required_work = {}

        valid_staff_count = 0
        duplicate_names: list[str] = []
        if state.staff_df is not None and "名前" in state.staff_df.columns:
            names = [str(name).strip() for name in state.staff_df["名前"].dropna().tolist() if str(name).strip()]
            valid_staff_count = len(names)
            duplicate_names = sorted({name for name in names if names.count(name) > 1})
        min_staff_required = max(sum(role.get("min_per_day", 1) for role in state.roles_config), 1)

        add_btn = ft.ElevatedButton("スタッフ追加", icon=ft.Icons.ADD, on_click=lambda e: _add_staff(state, on_ui_change))

        tab2_content.controls = [
            ft.Text("■ スタッフ編集", weight=ft.FontWeight.BOLD),
            ft.Text(f"有効スタッフ: {valid_staff_count}人 / 必要目安: {min_staff_required}人", size=12),
            ft.Text(
                f"名前が重複しています: {', '.join(duplicate_names)}",
                size=12,
                color=ft.Colors.RED_600,
                visible=bool(duplicate_names),
            ),
            add_btn,
            wrap_scrollable_table(build_staff_table(state, on_ui_change)),
            ft.Divider(height=20),
            ft.Text("■ 希望休設定", weight=ft.FontWeight.BOLD),
            wrap_scrollable_table(build_holidays_table(state, on_ui_change)) if state.dates else ft.Text("日付範囲が設定されていません"),
            ft.Divider(height=20),
            ft.Text("■ 出勤指定設定", weight=ft.FontWeight.BOLD),
            wrap_scrollable_table(build_required_work_table(state, on_ui_change)) if state.dates else ft.Text("日付範囲が設定されていません"),
        ]

        tab3_content.controls = build_generation_tab_controls(valid_staff_count)
        state.pending_full_refresh = False

    appbar = ft.AppBar(
        leading=ft.Icon(ft.Icons.CALENDAR_MONTH),
        leading_width=36,
        title_spacing=8,
        toolbar_height=52,
        title=ft.Text("シフト管理", size=20, weight=ft.FontWeight.BOLD),
        actions=[
            ft.Dropdown(
                value=state.current_store,
                options=[ft.dropdown.Option(str(s)) for s in state.stores] if state.stores else [],
                width=140,
                text_size=14,
                on_select=on_store_change,
            ),
            ft.IconButton(ft.Icons.SAVE, tooltip="保存", on_click=save_clicked),
            ft.IconButton(ft.Icons.LOGOUT, tooltip="ログアウト", on_click=logout_clicked),
        ],
        actions_padding=ft.padding.only(right=4),
    )

    if state.current_store:
        load_store_data(state.current_store)
    else:
        apply_default_shift_data()
        if state.start_d is None or state.end_d is None:
            state.start_d = datetime.date.today()
            state.end_d = state.start_d + datetime.timedelta(days=30)
            state.days_list = [
                state.start_d + datetime.timedelta(days=i)
                for i in range((state.end_d - state.start_d).days + 1)
            ]
        update_data_tables(full_refresh=True)

    def on_tabs_change(e):
        state.selected_tab_index = int(e.data)
        if state.pending_full_refresh and state.selected_tab_index in (1, 2):
            update_data_tables(full_refresh=True)
            page.update()

    tab_items = [
        ft.Tab(label="基本設定"),
        ft.Tab(label="スタッフ・休日設定"),
        ft.Tab(label="シフト生成"),
    ]
    tab_views = [
        ft.Container(content=tab1_content, padding=8),
        ft.Container(content=tab2_content, padding=8),
        ft.Container(content=tab3_content, padding=8),
    ]
    tabs = ft.Tabs(
        content=ft.Column(
            [
                ft.TabBar(
                    tabs=tab_items,
                    scrollable=True,
                    label_text_style=ft.TextStyle(size=13),
                    unselected_label_text_style=ft.TextStyle(size=13),
                    label_padding=ft.padding.symmetric(horizontal=10, vertical=0),
                ),
                ft.TabBarView(controls=tab_views, expand=True),
            ],
            spacing=0,
            expand=True,
        ),
        length=len(tab_items),
        selected_index=0,
        animation_duration=300,
        on_change=on_tabs_change,
        expand=True,
    )

    content = ft.Container(
        content=tabs,
        expand=True,
        padding=ft.padding.only(left=4, right=4, top=2, bottom=0),
    )

    return ft.View(
        route="/shift",
        appbar=appbar,
        controls=[content],
        navigation_bar=get_navigation_bar(page, 3, before_navigate=confirm_navigation_while_generating),
    )
