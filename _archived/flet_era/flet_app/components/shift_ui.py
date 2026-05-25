import flet as ft

from typing import Any, Callable


BOOLEAN_STAFF_FIELDS = ("正社員", "朝可", "夜可")
NUMERIC_STAFF_FIELDS = {
    "前月末の連勤数": 0,
    "最大連勤": 4,
    "公休数": 8,
}


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "y"}
    return bool(value)


def _coerce_int(value: Any, default: int) -> int:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _staff_role_names(state: Any) -> list[str]:
    return [str(role.get("name", "")).strip() for role in getattr(state, "roles_config", []) if role.get("name")]


def staff_defaults_for_roles(role_names: list[str]) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "name": "",
        "名前": "",
        "優先役割": "なし",
        "正社員": False,
        "朝可": True,
        "夜可": False,
        "前月末の連勤数": 0,
        "最大連勤": 4,
        "公休数": 8,
    }
    for role_name in role_names:
        defaults[role_name] = False
    return defaults


def staff_dataframe_columns(role_names: list[str], existing_columns: list[str] | None = None) -> list[str]:
    desired = [
        "名前",
        "優先役割",
        "正社員",
        "朝可",
        "夜可",
        *role_names,
        "前月末の連勤数",
        "最大連勤",
        "公休数",
    ]
    if not existing_columns:
        return desired
    extras = [column for column in existing_columns if column not in desired]
    return desired + extras


def normalize_staff_entry(staff: dict[str, Any], role_names: list[str]) -> dict[str, Any]:
    normalized = {**staff_defaults_for_roles(role_names), **dict(staff)}
    name = str(staff.get("name") or staff.get("名前") or "").strip()
    normalized["name"] = name
    normalized["名前"] = name

    preferred_role = normalized.get("優先役割", "なし")
    normalized["優先役割"] = preferred_role if preferred_role in {"なし", *role_names} else "なし"

    for field_name in BOOLEAN_STAFF_FIELDS:
        normalized[field_name] = _coerce_bool(normalized.get(field_name, False))
    for role_name in role_names:
        normalized[role_name] = _coerce_bool(normalized.get(role_name, False))
    for field_name, default in NUMERIC_STAFF_FIELDS.items():
        normalized[field_name] = _coerce_int(normalized.get(field_name), default)

    return normalized


def _staff_name(staff: dict[str, Any]) -> str:
    return str(staff.get("name") or staff.get("名前") or "").strip()


def _rename_day_mapping_key(mapping: dict[str, list[str]], old_name: str, new_name: str) -> None:
    if not old_name or old_name == new_name or old_name not in mapping:
        return
    old_values = list(mapping.pop(old_name))
    if not new_name:
        return
    merged = set(mapping.get(new_name, []))
    merged.update(old_values)
    mapping[new_name] = sorted(merged)


def _staff_text_field(value: str, width: int, on_change: Callable) -> ft.TextField:
    return ft.TextField(
        value=value,
        width=width,
        dense=True,
        height=36,
        text_size=12,
        content_padding=ft.padding.symmetric(horizontal=8, vertical=6),
        on_change=on_change,
    )


def _staff_number_field(value: int, width: int, on_change: Callable) -> ft.TextField:
    return ft.TextField(
        value=str(value),
        width=width,
        dense=True,
        height=36,
        text_size=12,
        keyboard_type=ft.KeyboardType.NUMBER,
        content_padding=ft.padding.symmetric(horizontal=8, vertical=6),
        on_change=on_change,
    )


def _checkbox_cell(value: bool, on_change: Callable) -> ft.DataCell:
    return ft.DataCell(
        ft.Container(
            content=ft.Checkbox(value=value, scale=0.9, visual_density=ft.VisualDensity.COMPACT, on_change=on_change),
            width=40,
            alignment=ft.Alignment(0, 0),
        )
    )


def build_staff_table(state: Any, on_change: Callable) -> ft.DataTable:
    role_names = _staff_role_names(state)
    preferred_role_options = ["なし", *role_names]
    columns = [
        ft.DataColumn(ft.Text("No.")),
        ft.DataColumn(ft.Text("名前")),
        ft.DataColumn(ft.Text("優先役割")),
        ft.DataColumn(ft.Text("社員")),
        ft.DataColumn(ft.Text("朝")),
        ft.DataColumn(ft.Text("夜")),
    ]
    columns.extend(ft.DataColumn(ft.Text(role_name)) for role_name in role_names)
    columns.extend(
        [
            ft.DataColumn(ft.Text("前連勤")),
            ft.DataColumn(ft.Text("最大連")),
            ft.DataColumn(ft.Text("公休")),
            ft.DataColumn(ft.Text("削除")),
        ]
    )

    rows: list[ft.DataRow] = []
    for idx, staff in enumerate(state.staff_list):
        normalized = normalize_staff_entry(staff, role_names)
        state.staff_list[idx] = normalized
        rows.append(
            ft.DataRow(
                cells=[
                    ft.DataCell(
                        ft.Container(
                            content=ft.Text(str(idx + 1), size=11),
                            width=32,
                            alignment=ft.Alignment(0, 0),
                        )
                    ),
                    ft.DataCell(
                        _staff_text_field(
                            normalized["name"],
                            150,
                            lambda e, i=idx: update_staff(state, i, "name", e.control.value, on_change),
                        )
                    ),
                    ft.DataCell(
                        ft.Dropdown(
                            value=normalized["優先役割"],
                            width=112,
                            height=36,
                            text_size=12,
                            content_padding=ft.padding.symmetric(horizontal=8, vertical=4),
                            options=[ft.dropdown.Option(option) for option in preferred_role_options],
                            on_select=lambda e, i=idx: update_staff(
                                state, i, "優先役割", e.control.value, on_change
                            ),
                        )
                    ),
                    _checkbox_cell(
                        normalized["正社員"],
                        lambda e, i=idx: update_staff(state, i, "正社員", e.control.value, on_change),
                    ),
                    _checkbox_cell(
                        normalized["朝可"],
                        lambda e, i=idx: update_staff(state, i, "朝可", e.control.value, on_change),
                    ),
                    _checkbox_cell(
                        normalized["夜可"],
                        lambda e, i=idx: update_staff(state, i, "夜可", e.control.value, on_change),
                    ),
                    *[
                        _checkbox_cell(
                            normalized[role_name],
                            lambda e, i=idx, key=role_name: update_staff(
                                state, i, key, e.control.value, on_change
                            ),
                        )
                        for role_name in role_names
                    ],
                    ft.DataCell(
                        _staff_number_field(
                            normalized["前月末の連勤数"],
                            64,
                            lambda e, i=idx: update_staff(
                                state, i, "前月末の連勤数", e.control.value, on_change
                            ),
                        )
                    ),
                    ft.DataCell(
                        _staff_number_field(
                            normalized["最大連勤"],
                            64,
                            lambda e, i=idx: update_staff(state, i, "最大連勤", e.control.value, on_change),
                        )
                    ),
                    ft.DataCell(
                        _staff_number_field(
                            normalized["公休数"],
                            64,
                            lambda e, i=idx: update_staff(state, i, "公休数", e.control.value, on_change),
                        )
                    ),
                    ft.DataCell(
                        ft.IconButton(
                            ft.Icons.DELETE,
                            icon_size=18,
                            tooltip="スタッフを削除",
                            on_click=lambda e, i=idx: delete_staff(state, i, on_change),
                        )
                    ),
                ]
            )
        )

    return ft.DataTable(
        columns=columns,
        rows=rows,
        column_spacing=10,
        horizontal_margin=8,
        heading_row_height=36,
        data_row_min_height=40,
        data_row_max_height=40,
        divider_thickness=0.5,
    )


def update_staff(state: Any, index: int, key: str, value: Any, on_change: Callable) -> None:
    role_names = _staff_role_names(state)
    staff = normalize_staff_entry(state.staff_list[index], role_names)
    previous_name = _staff_name(staff)

    if key in BOOLEAN_STAFF_FIELDS or key in role_names:
        staff[key] = _coerce_bool(value)
    elif key in NUMERIC_STAFF_FIELDS:
        staff[key] = _coerce_int(value, NUMERIC_STAFF_FIELDS[key])
    elif key in {"name", "名前"}:
        new_name = str(value).strip()
        staff["name"] = new_name
        staff["名前"] = new_name
        _rename_day_mapping_key(state.holidays, previous_name, new_name)
        _rename_day_mapping_key(state.required_work, previous_name, new_name)
    elif key == "優先役割":
        staff[key] = value if value in {"なし", *role_names} else "なし"
    else:
        staff[key] = value

    state.staff_list[index] = normalize_staff_entry(staff, role_names)


def delete_staff(state: Any, index: int, on_change: Callable) -> None:
    role_names = _staff_role_names(state)
    staff = normalize_staff_entry(state.staff_list[index], role_names)
    staff_name = _staff_name(staff)
    state.staff_list.pop(index)
    if staff_name:
        state.holidays.pop(staff_name, None)
        state.required_work.pop(staff_name, None)
    on_change(force_full_refresh=True)


def _add_staff(state: Any, on_change: Callable) -> None:
    state.staff_list.append(normalize_staff_entry({}, _staff_role_names(state)))
    on_change(force_full_refresh=True)


def build_holidays_table(state: Any, on_change: Callable) -> ft.DataTable:
    columns = [ft.DataColumn(ft.Text("名前"))]
    for date in state.dates:
        columns.append(ft.DataColumn(ft.Text(date)))

    rows = []
    for staff in state.staff_list:
        name = _staff_name(staff)
        cells = [ft.DataCell(ft.Text(name))]
        for date in state.dates:
            is_checked = date in state.holidays.get(name, [])
            cells.append(
                ft.DataCell(
                    ft.Checkbox(
                        value=is_checked,
                        scale=0.9,
                        visual_density=ft.VisualDensity.COMPACT,
                        on_change=lambda e, n=name, d=date: update_holiday(
                            state, n, d, e.control.value, on_change
                        ),
                    )
                )
            )
        rows.append(ft.DataRow(cells=cells))
    return ft.DataTable(
        columns=columns,
        rows=rows,
        column_spacing=8,
        horizontal_margin=8,
        heading_row_height=34,
        data_row_min_height=36,
        data_row_max_height=36,
        divider_thickness=0.5,
    )


def update_holiday(state: Any, name: str, date: str, is_checked: bool, on_change: Callable) -> None:
    if not name:
        return
    if name not in state.holidays:
        state.holidays[name] = []
    if is_checked and date not in state.holidays[name]:
        state.holidays[name].append(date)
    elif not is_checked and date in state.holidays[name]:
        state.holidays[name].remove(date)


def build_required_work_table(state: Any, on_change: Callable) -> ft.DataTable:
    columns = [ft.DataColumn(ft.Text("名前"))]
    for date in state.dates:
        columns.append(ft.DataColumn(ft.Text(date)))

    rows = []
    for staff in state.staff_list:
        name = _staff_name(staff)
        cells = [ft.DataCell(ft.Text(name))]
        for date in state.dates:
            is_checked = date in state.required_work.get(name, [])
            cells.append(
                ft.DataCell(
                    ft.Checkbox(
                        value=is_checked,
                        scale=0.9,
                        visual_density=ft.VisualDensity.COMPACT,
                        on_change=lambda e, n=name, d=date: update_required(
                            state, n, d, e.control.value, on_change
                        ),
                    )
                )
            )
        rows.append(ft.DataRow(cells=cells))
    return ft.DataTable(
        columns=columns,
        rows=rows,
        column_spacing=8,
        horizontal_margin=8,
        heading_row_height=34,
        data_row_min_height=36,
        data_row_max_height=36,
        divider_thickness=0.5,
    )


def update_required(state: Any, name: str, date: str, is_checked: bool, on_change: Callable) -> None:
    if not name:
        return
    if name not in state.required_work:
        state.required_work[name] = []
    if is_checked and date not in state.required_work[name]:
        state.required_work[name].append(date)
    elif not is_checked and date in state.required_work[name]:
        state.required_work[name].remove(date)
