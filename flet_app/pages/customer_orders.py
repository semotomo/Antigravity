from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Optional

import flet as ft

from flet_app.components.navigation import get_navigation_bar
from flet_app.core.customer_orders import db as customer_orders_db
from flet_app.core.customer_orders.view_model import (
    ACTIVE_TAB_STATUSES,
    KNOWN_STATUSES,
    STATUS_LABELS,
    TERMINAL_STATUSES,
    build_status_counts,
    get_next_status_action,
    normalize_order_payload,
    normalize_order_record,
    orders_for_status,
    sort_orders_for_display,
)
from flet_app.core.supabase_client import supabase


STATUS_COLORS = {
    "pending": (ft.Colors.AMBER_50, ft.Colors.AMBER_900),
    "ordered": (ft.Colors.BLUE_50, ft.Colors.BLUE_900),
    "arrived": (ft.Colors.ORANGE_50, ft.Colors.ORANGE_900),
    "contacted": (ft.Colors.TEAL_50, ft.Colors.TEAL_900),
    "completed": (ft.Colors.GREEN_50, ft.Colors.GREEN_900),
    "cancelled": (ft.Colors.RED_50, ft.Colors.RED_900),
}


@dataclass
class CustomerOrdersState:
    orders: list[dict] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=lambda: build_status_counts([]))
    loading: bool = True
    selected_tab_index: int = 0
    editing_order_id: Optional[str] = None


class CustomerOrdersPageController:
    """客注管理画面の UI と状態管理をまとめるクラス。"""

    def __init__(self, page: ft.Page):
        self.page = page
        self.state = CustomerOrdersState()
        self.summary_value_texts: dict[str, ft.Text] = {}
        self.status_buttons: dict[str, ft.OutlinedButton] = {}

        self.status_text = ft.Text("客注データを読み込んでいます...")
        self.archive_text = ft.Text(
            "完了 0件 / キャンセル 0件",
            color=ft.Colors.ON_SURFACE_VARIANT,
        )

        self.customer_name_input = ft.TextField(label="お客様名 *", autofocus=True)
        self.phone_number_input = ft.TextField(label="電話番号 *")
        self.item_name_input = ft.TextField(label="商品名 / 数量 *")
        self.item_details_input = ft.TextField(
            label="メーカー・品番など",
            hint_text="任意",
        )
        self.staff_name_input = ft.TextField(label="受付スタッフ名", hint_text="任意")
        self.notes_input = ft.TextField(
            label="メモ",
            hint_text="任意",
            multiline=True,
            min_lines=2,
            max_lines=4,
        )
        self.status_dropdown = ft.Dropdown(
            label="ステータス",
            value="pending",
            options=[
                ft.dropdown.Option(status, STATUS_LABELS[status]) for status in KNOWN_STATUSES
            ],
        )
        self.form_error_text = ft.Text("", color=ft.Colors.ERROR, visible=False)
        self.form_progress_ring = ft.ProgressRing(width=18, height=18, visible=False)
        self.form_submit_button = ft.Button(
            content="登録する",
            icon=ft.Icons.SAVE_OUTLINED,
            on_click=self.submit_order_form,
        )
        self.form_cancel_button = ft.TextButton(
            "閉じる",
            on_click=lambda e: self.close_dialog(),
        )

        self.form_dialog = ft.AlertDialog(
            modal=True,
            title=ft.Text("新規客注を登録"),
            content=ft.Container(
                width=720,
                content=ft.Column(
                    [
                        ft.ResponsiveRow(
                            [
                                self._field_container(self.customer_name_input),
                                self._field_container(self.phone_number_input),
                                self._field_container(self.item_name_input, full_width=True),
                                self._field_container(self.item_details_input, full_width=True),
                                self._field_container(self.staff_name_input),
                                self._field_container(self.status_dropdown),
                            ],
                            spacing=12,
                            run_spacing=12,
                        ),
                        self.notes_input,
                        ft.Row(
                            [self.form_progress_ring, self.form_error_text],
                            spacing=10,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                    ],
                    spacing=12,
                    tight=True,
                    scroll=ft.ScrollMode.AUTO,
                ),
            ),
            actions=[self.form_cancel_button, self.form_submit_button],
            actions_alignment=ft.MainAxisAlignment.END,
        )

        self.summary_cards = ft.ResponsiveRow(
            [self._build_summary_card(status) for status in KNOWN_STATUSES],
            spacing=12,
            run_spacing=12,
        )
        self.hero_banner = self._build_hero_banner()
        self.active_status_container = ft.Container(
            expand=True,
            content=self._build_status_body(ACTIVE_TAB_STATUSES[self.state.selected_tab_index]),
        )
        self.tab_controls = self._build_tabs()

    def _field_container(self, control: ft.Control, full_width: bool = False) -> ft.Container:
        return ft.Container(
            content=control,
            col={"xs": 12, "md": 12 if full_width else 6},
        )

    def _build_hero_banner(self) -> ft.Control:
        return ft.Container(
            padding=16,
            border_radius=18,
            bgcolor=ft.Colors.BLUE_GREY_900,
            content=ft.Column(
                [
                    ft.Text(
                        "客注管理",
                        size=26,
                        weight=ft.FontWeight.BOLD,
                        color=ft.Colors.WHITE,
                    ),
                    ft.Text(
                        "未発注からお渡し完了まで、店舗で追いかけやすい順にまとめています。",
                        color=ft.Colors.BLUE_GREY_100,
                    ),
                    ft.Row(
                        [
                            self.status_text,
                            ft.Container(width=12),
                            self.archive_text,
                        ],
                        wrap=True,
                        run_spacing=6,
                        spacing=0,
                    ),
                ],
                spacing=10,
                tight=True,
            ),
        )

    def _build_summary_card(self, status: str) -> ft.Control:
        accent_bg, accent_text = STATUS_COLORS.get(
            status, (ft.Colors.SURFACE_CONTAINER_HIGHEST, ft.Colors.ON_SURFACE)
        )
        value_text = ft.Text(
            "0件",
            size=24,
            weight=ft.FontWeight.BOLD,
            color=accent_text,
        )
        self.summary_value_texts[status] = value_text

        return ft.Container(
            col={"xs": 6, "sm": 4, "lg": 2},
            padding=14,
            border_radius=16,
            bgcolor=accent_bg,
            content=ft.Column(
                [
                    ft.Text(STATUS_LABELS[status], color=accent_text),
                    value_text,
                ],
                spacing=6,
                tight=True,
            ),
        )

    def _build_tabs(self) -> ft.Control:
        selector_buttons: list[ft.Control] = []
        for index, status in enumerate(ACTIVE_TAB_STATUSES):
            button = ft.OutlinedButton(
                content=self._tab_label(status),
                on_click=lambda e, idx=index: self.set_selected_tab(idx),
            )
            self.status_buttons[status] = button
            selector_buttons.append(button)

        return ft.Column(
            [
                ft.Row(
                    selector_buttons,
                    wrap=True,
                    run_spacing=8,
                    spacing=8,
                ),
                self.active_status_container,
            ],
            spacing=12,
            expand=True,
        )

    def _tab_label(self, status: str) -> str:
        return f"{STATUS_LABELS[status]} ({self.state.counts.get(status, 0)})"

    def _status_badge(self, status: str) -> ft.Control:
        bg_color, text_color = STATUS_COLORS.get(
            status, (ft.Colors.SURFACE_CONTAINER_HIGHEST, ft.Colors.ON_SURFACE)
        )
        return ft.Container(
            padding=ft.padding.symmetric(horizontal=10, vertical=6),
            border_radius=999,
            bgcolor=bg_color,
            content=ft.Text(
                STATUS_LABELS.get(status, status),
                size=12,
                color=text_color,
                weight=ft.FontWeight.W_600,
            ),
        )

    def _info_item(
        self,
        label: str,
        value: str,
        col: Optional[dict] = None,
        selectable: bool = False,
    ) -> ft.Control:
        display_value = value or "-"
        return ft.Container(
            col=col or {"xs": 12, "sm": 6, "md": 4},
            padding=12,
            border_radius=14,
            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
            content=ft.Column(
                [
                    ft.Text(label, size=11, color=ft.Colors.ON_SURFACE_VARIANT),
                    ft.Text(
                        display_value,
                        size=14,
                        weight=ft.FontWeight.W_600,
                        selectable=selectable,
                    ),
                ],
                spacing=6,
                tight=True,
            ),
        )

    def _build_status_body(self, status: str) -> ft.Control:
        if self.state.loading:
            return ft.Container(
                expand=True,
                padding=24,
                content=ft.Row(
                    [ft.ProgressRing(), ft.Text("客注データを読み込んでいます...")],
                    alignment=ft.MainAxisAlignment.CENTER,
                ),
            )

        orders = orders_for_status(self.state.orders, status)
        if not orders:
            return ft.Container(
                expand=True,
                padding=24,
                border_radius=16,
                bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                content=ft.Column(
                    [
                        ft.Icon(ft.Icons.INBOX_OUTLINED, size=32, color=ft.Colors.ON_SURFACE_VARIANT),
                        ft.Text(
                            f"{STATUS_LABELS[status]} の客注はまだありません。",
                            color=ft.Colors.ON_SURFACE_VARIANT,
                            text_align=ft.TextAlign.CENTER,
                        ),
                    ],
                    horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=12,
                    tight=True,
                ),
            )

        return ft.Container(
            expand=True,
            content=ft.Column(
                [self._build_order_card(order) for order in orders],
                spacing=12,
                scroll=ft.ScrollMode.AUTO,
                expand=True,
            ),
        )

    def _build_order_card(self, order: dict) -> ft.Control:
        next_status, action_label = get_next_status_action(order["status"])
        actions: list[ft.Control] = []

        if next_status and action_label:
            actions.append(
                ft.Button(
                    content=action_label,
                    icon=ft.Icons.ARROW_FORWARD,
                    on_click=lambda e, oid=order["id"], ns=next_status: self.advance_order_status(
                        oid, ns
                    ),
                )
            )

        actions.append(
            ft.OutlinedButton(
                content="編集",
                icon=ft.Icons.EDIT_OUTLINED,
                on_click=lambda e, current=order: self.open_edit_dialog(current),
            )
        )

        if order["status"] not in TERMINAL_STATUSES:
            actions.append(
                ft.TextButton(
                    "キャンセルにする",
                    on_click=lambda e, current=order: self.confirm_cancel_order(current),
                )
            )

        actions.append(
            ft.TextButton(
                "削除",
                on_click=lambda e, current=order: self.confirm_delete_order(current),
            )
        )

        detail_controls: list[ft.Control] = []
        if order["item_details"]:
            detail_controls.append(
                ft.Container(
                    padding=12,
                    border_radius=14,
                    bgcolor=ft.Colors.BLUE_GREY_50,
                    content=ft.Column(
                        [
                            ft.Text(
                                "補足情報",
                                size=11,
                                color=ft.Colors.ON_SURFACE_VARIANT,
                            ),
                            ft.Text(order["item_details"]),
                        ],
                        spacing=6,
                        tight=True,
                    ),
                )
            )

        if order["notes"]:
            detail_controls.append(
                ft.Container(
                    padding=12,
                    border_radius=14,
                    bgcolor=ft.Colors.AMBER_50,
                    content=ft.Column(
                        [
                            ft.Text(
                                "メモ",
                                size=11,
                                color=ft.Colors.ON_SURFACE_VARIANT,
                            ),
                            ft.Text(order["notes"]),
                        ],
                        spacing=6,
                        tight=True,
                    ),
                )
            )

        return ft.Container(
            padding=16,
            border_radius=18,
            bgcolor=ft.Colors.WHITE,
            border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
            shadow=ft.BoxShadow(
                spread_radius=0,
                blur_radius=12,
                color=ft.Colors.with_opacity(0.08, ft.Colors.BLACK),
                offset=ft.Offset(0, 3),
            ),
            content=ft.Column(
                [
                    ft.Row(
                        [
                            ft.Column(
                                [
                                    ft.Text(
                                        order["customer_name"] or "お客様名未設定",
                                        size=20,
                                        weight=ft.FontWeight.BOLD,
                                    ),
                                    ft.Text(
                                        order["item_name"] or "-",
                                        color=ft.Colors.ON_SURFACE_VARIANT,
                                    ),
                                ],
                                spacing=4,
                                expand=True,
                                tight=True,
                            ),
                            self._status_badge(order["status"]),
                        ],
                        wrap=True,
                        run_spacing=8,
                        alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                    ),
                    ft.ResponsiveRow(
                        [
                            self._info_item(
                                "電話番号",
                                order["phone_number"],
                                selectable=True,
                            ),
                            self._info_item("受付スタッフ", order["staff_name"] or "-"),
                            self._info_item("登録日時", order["created_label"]),
                            self._info_item("更新日時", order["updated_label"]),
                        ],
                        spacing=10,
                        run_spacing=10,
                    ),
                    *detail_controls,
                    ft.Row(
                        actions,
                        wrap=True,
                        run_spacing=8,
                        spacing=8,
                    ),
                ],
                spacing=14,
                tight=True,
            ),
        )

    def build_view(self) -> ft.View:
        appbar = ft.AppBar(
            leading=ft.Icon(ft.Icons.ASSIGNMENT),
            leading_width=36,
            title_spacing=8,
            toolbar_height=52,
            title=ft.Text("客注管理", size=20, weight=ft.FontWeight.BOLD),
            actions=[
                ft.IconButton(
                    icon=ft.Icons.REFRESH,
                    tooltip="再読み込み",
                    on_click=self.reload_orders,
                ),
                ft.IconButton(
                    icon=ft.Icons.LOGOUT,
                    tooltip="ログアウト",
                    on_click=self.logout,
                ),
            ],
            actions_padding=ft.padding.only(right=4),
        )

        return ft.View(
            route="/customer-orders",
            appbar=appbar,
            controls=[
                ft.Container(
                    expand=True,
                    padding=ft.padding.only(left=8, right=8, top=8, bottom=8),
                    content=ft.Column(
                        [
                            self.hero_banner,
                            self.summary_cards,
                            ft.Container(
                                expand=True,
                                padding=14,
                                border_radius=18,
                                bgcolor=ft.Colors.SURFACE_CONTAINER_LOWEST,
                                content=self.tab_controls,
                            ),
                        ],
                        spacing=14,
                        expand=True,
                    ),
                )
            ],
            floating_action_button=ft.FloatingActionButton(
                icon=ft.Icons.ADD,
                tooltip="新規客注を登録",
                on_click=self.open_create_dialog,
            ),
            navigation_bar=get_navigation_bar(page=self.page, selected_index=3),
        )

    async def logout(self, e):
        token = getattr(self.page, "access_token", None)
        if token:
            try:
                supabase.sign_out(token)
            except Exception:
                pass
        setattr(self.page, "is_authenticated", False)
        setattr(self.page, "access_token", None)
        await self.page.push_route("/login")

    def set_status(self, message: str, color: str = ft.Colors.ON_SURFACE_VARIANT):
        self.status_text.value = message
        self.status_text.color = color

    def close_dialog(self):
        self.page.pop_dialog()
        self.page.update()

    def clear_form_errors(self):
        self.form_error_text.value = ""
        self.form_error_text.visible = False
        self.customer_name_input.error_text = None
        self.phone_number_input.error_text = None
        self.item_name_input.error_text = None

    def set_form_busy(self, busy: bool):
        self.form_progress_ring.visible = busy
        self.form_submit_button.disabled = busy
        self.form_cancel_button.disabled = busy

    def _raw_form_payload(self) -> dict:
        return {
            "customer_name": self.customer_name_input.value,
            "phone_number": self.phone_number_input.value,
            "item_name": self.item_name_input.value,
            "item_details": self.item_details_input.value,
            "staff_name": self.staff_name_input.value,
            "notes": self.notes_input.value,
            "status": self.status_dropdown.value or "pending",
        }

    def validate_form(self) -> dict | None:
        self.clear_form_errors()
        missing = False

        if not str(self.customer_name_input.value or "").strip():
            self.customer_name_input.error_text = "お客様名を入力してください。"
            missing = True
        if not str(self.phone_number_input.value or "").strip():
            self.phone_number_input.error_text = "電話番号を入力してください。"
            missing = True
        if not str(self.item_name_input.value or "").strip():
            self.item_name_input.error_text = "商品名 / 数量を入力してください。"
            missing = True

        if missing:
            return None

        try:
            return normalize_order_payload(self._raw_form_payload())
        except ValueError as ex:
            self.form_error_text.value = str(ex)
            self.form_error_text.visible = True
            return None

    def reset_form(self):
        self.state.editing_order_id = None
        self.customer_name_input.value = ""
        self.phone_number_input.value = ""
        self.item_name_input.value = ""
        self.item_details_input.value = ""
        self.staff_name_input.value = ""
        self.notes_input.value = ""
        self.status_dropdown.value = "pending"
        self.clear_form_errors()
        self.set_form_busy(False)

    def open_create_dialog(self, e=None):
        self.reset_form()
        self.form_dialog.title = ft.Text("新規客注を登録")
        self.form_submit_button.content = "登録する"
        self.page.show_dialog(self.form_dialog)
        self.page.update()

    def open_edit_dialog(self, order: dict):
        self.reset_form()
        self.state.editing_order_id = order["id"]
        self.customer_name_input.value = order["customer_name"]
        self.phone_number_input.value = order["phone_number"]
        self.item_name_input.value = order["item_name"]
        self.item_details_input.value = order["item_details"]
        self.staff_name_input.value = order["staff_name"]
        self.notes_input.value = order["notes"]
        self.status_dropdown.value = order["status"]
        self.form_dialog.title = ft.Text("客注を編集")
        self.form_submit_button.content = "更新する"
        self.page.show_dialog(self.form_dialog)
        self.page.update()

    def submit_order_form(self, e=None):
        payload = self.validate_form()
        if payload is None:
            self.page.update()
            return

        editing_order_id = self.state.editing_order_id
        self.set_form_busy(True)
        self.page.update()
        self.page.run_task(self._save_order_task, payload, editing_order_id)

    async def _save_order_task(self, payload: dict, editing_order_id: Optional[str]):
        try:
            if editing_order_id:
                saved = await asyncio.to_thread(
                    customer_orders_db.update_customer_order, editing_order_id, payload
                )
                self.set_status("客注を更新しました。", ft.Colors.PRIMARY)
            else:
                saved = await asyncio.to_thread(customer_orders_db.create_customer_order, payload)
                self.set_status("客注を登録しました。", ft.Colors.PRIMARY)

            if not saved:
                raise RuntimeError("客注データを保存できませんでした。")

            self.upsert_order(saved)
            self.close_dialog()
        except Exception as ex:
            self.form_error_text.value = str(ex)
            self.form_error_text.visible = True
            self.set_status("客注の保存に失敗しました。", ft.Colors.ERROR)
            self.set_form_busy(False)
            self.page.update()

    def set_selected_tab(self, index: int):
        self.state.selected_tab_index = index
        self.refresh_views()
        self.page.update()

    def _selected_tab_style(self, selected: bool) -> ft.ButtonStyle:
        return ft.ButtonStyle(
            bgcolor=ft.Colors.PRIMARY_CONTAINER if selected else ft.Colors.WHITE,
            color=ft.Colors.PRIMARY if selected else ft.Colors.ON_SURFACE,
            side=ft.border.BorderSide(
                1,
                ft.Colors.PRIMARY if selected else ft.Colors.OUTLINE_VARIANT,
            ),
            padding=ft.padding.symmetric(horizontal=14, vertical=10),
            shape=ft.RoundedRectangleBorder(radius=14),
        )

    def reload_orders(self, e=None):
        self.state.loading = True
        self.set_status("客注データを読み込んでいます...")
        self.refresh_views()
        self.page.update()
        self.page.run_task(self._load_orders_task)

    async def _load_orders_task(self):
        try:
            records = await asyncio.to_thread(customer_orders_db.list_customer_orders, None, 500)
            self.state.orders = sort_orders_for_display(records)
            self.state.counts = build_status_counts(self.state.orders)
            self.state.loading = False
            self.refresh_views()
            active_count = sum(self.state.counts.get(status, 0) for status in ACTIVE_TAB_STATUSES)
            self.set_status(f"進行中の客注 {active_count}件を表示中です。", ft.Colors.PRIMARY)
        except Exception as ex:
            self.state.orders = []
            self.state.counts = build_status_counts([])
            self.state.loading = False
            self.refresh_views()
            self.set_status("客注データの読込に失敗しました。", ft.Colors.ERROR)
            self.show_message_dialog("読込エラー", str(ex))
        finally:
            self.page.update()

    def refresh_views(self):
        for status in KNOWN_STATUSES:
            value_text = self.summary_value_texts.get(status)
            if value_text is not None:
                value_text.value = f"{self.state.counts.get(status, 0)}件"

        for index, status in enumerate(ACTIVE_TAB_STATUSES):
            button = self.status_buttons.get(status)
            if button is not None:
                button.content = self._tab_label(status)
                button.style = self._selected_tab_style(index == self.state.selected_tab_index)

        active_status = ACTIVE_TAB_STATUSES[self.state.selected_tab_index]
        self.active_status_container.content = self._build_status_body(active_status)

        self.archive_text.value = (
            f"完了 {self.state.counts.get('completed', 0)}件 / "
            f"キャンセル {self.state.counts.get('cancelled', 0)}件"
        )

    def upsert_order(self, record: dict):
        normalized = normalize_order_record(record)
        updated = False
        for index, current in enumerate(self.state.orders):
            if current["id"] == normalized["id"]:
                self.state.orders[index] = normalized
                updated = True
                break
        if not updated:
            self.state.orders.append(normalized)

        self.state.orders = sort_orders_for_display(self.state.orders)
        self.state.counts = build_status_counts(self.state.orders)
        self.refresh_views()
        self.reset_form()
        self.page.update()

    def remove_order(self, order_id: str):
        self.state.orders = [order for order in self.state.orders if order["id"] != order_id]
        self.state.counts = build_status_counts(self.state.orders)
        self.refresh_views()
        self.page.update()

    def advance_order_status(self, order_id: str, next_status: str):
        self.set_status("ステータスを更新しています...")
        self.page.update()
        self.page.run_task(self._update_status_task, order_id, next_status)

    async def _update_status_task(self, order_id: str, next_status: str):
        try:
            record = await asyncio.to_thread(
                customer_orders_db.update_customer_order_status, order_id, next_status
            )
            if not record:
                raise RuntimeError("ステータス更新後のデータを取得できませんでした。")
            self.upsert_order(record)
            self.set_status(
                f"ステータスを「{STATUS_LABELS[next_status]}」へ更新しました。",
                ft.Colors.PRIMARY,
            )
        except Exception as ex:
            self.set_status("ステータス更新に失敗しました。", ft.Colors.ERROR)
            self.show_message_dialog("更新エラー", str(ex))

    def confirm_cancel_order(self, order: dict):
        self.show_confirm_dialog(
            title="キャンセルに変更しますか",
            message=f"「{order['customer_name']}」様の客注をキャンセル扱いにします。",
            confirm_label="キャンセルにする",
            on_confirm=lambda: self.advance_order_status(order["id"], "cancelled"),
        )

    def confirm_delete_order(self, order: dict):
        self.show_confirm_dialog(
            title="客注を削除しますか",
            message=(
                f"「{order['customer_name']}」様の客注を削除します。"
                "この操作は元に戻せません。"
            ),
            confirm_label="削除する",
            on_confirm=lambda: self.delete_order(order["id"]),
        )

    def delete_order(self, order_id: str):
        self.set_status("客注を削除しています...")
        self.page.update()
        self.page.run_task(self._delete_order_task, order_id)

    async def _delete_order_task(self, order_id: str):
        try:
            await asyncio.to_thread(customer_orders_db.delete_customer_order, order_id)
            self.remove_order(order_id)
            self.set_status("客注を削除しました。", ft.Colors.PRIMARY)
        except Exception as ex:
            self.set_status("客注の削除に失敗しました。", ft.Colors.ERROR)
            self.show_message_dialog("削除エラー", str(ex))

    def show_message_dialog(self, title: str, message: str):
        self.page.show_dialog(
            ft.AlertDialog(
                title=ft.Text(title),
                content=ft.Text(message),
            )
        )

    def show_confirm_dialog(
        self,
        title: str,
        message: str,
        confirm_label: str,
        on_confirm,
    ):
        dialog: ft.AlertDialog

        def handle_confirm(e=None):
            self.close_dialog()
            on_confirm()

        dialog = ft.AlertDialog(
            modal=True,
            title=ft.Text(title),
            content=ft.Text(message),
            actions=[
                ft.TextButton("閉じる", on_click=lambda e: self.close_dialog()),
                ft.TextButton(confirm_label, on_click=handle_confirm),
            ],
            actions_alignment=ft.MainAxisAlignment.END,
        )
        self.page.show_dialog(dialog)
        self.page.update()


def CustomerOrdersView(page: ft.Page) -> ft.View:
    controller = CustomerOrdersPageController(page)
    setattr(page, "_customer_orders_controller", controller)
    view = controller.build_view()
    page.run_task(controller._load_orders_task)
    return view
