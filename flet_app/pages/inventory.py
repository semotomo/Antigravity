import io
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import flet as ft
import pandas as pd

from flet_app.components.navigation import get_navigation_bar
from flet_app.core.inventory import db
from flet_app.core.inventory.view_model import (
    available_destination_stores,
    build_web_asset_url,
    choose_default_from_store_id,
    format_product_rows,
    format_transfer_history,
    make_transfer_item,
    normalize_store_records,
    prepare_transfer_payload,
    summarize_transfer_items,
)
from flet_app.core.supabase_client import supabase

ALL_STORES = "__ALL__"
JAN_SCANNER_ASSET_URL = "/assets/jan_scanner.html"


@dataclass
class InventoryState:
    stores: list[dict] = field(default_factory=list)
    from_store_id: Optional[str] = None
    to_store_id: Optional[str] = None
    transfer_list: list[dict] = field(default_factory=list)
    selected_product: Optional[dict] = None
    last_lookup_jan: str = ""
    lookup_missing: bool = False
    history_date_from: date = field(default_factory=lambda: date.today() - timedelta(days=30))
    history_date_to: date = field(default_factory=date.today)
    history_from_store_id: str = ALL_STORES
    history_to_store_id: str = ALL_STORES
    history_rows: list[dict] = field(default_factory=list)
    products: list[dict] = field(default_factory=list)
    product_count: int = 0
    master_search_result: Optional[dict] = None


def InventoryView(page: ft.Page):
    state = InventoryState()
    pending_scanned_jan = ""

    def show_dialog(title: str, message: str):
        page.show_dialog(
            ft.AlertDialog(
                title=ft.Text(title),
                content=ft.Text(message),
            )
        )

    def set_status(message: str, color: str = ft.Colors.ON_SURFACE_VARIANT):
        status_text.value = message
        status_text.color = color

    def parse_int_input(value: str, field_name: str, default: int = 0) -> int:
        text = str(value or "").strip()
        if not text:
            return default
        try:
            return int(text)
        except ValueError as ex:
            raise ValueError(f"{field_name}は数字で入力してください。") from ex

    async def logout(e):
        token = getattr(page, "access_token", None)
        if token:
            try:
                supabase.sign_out(token)
            except Exception:
                pass
        setattr(page, "is_authenticated", False)
        setattr(page, "access_token", None)
        await page.push_route("/login")

    def metric_card(label: str, value: str, icon: str) -> ft.Control:
        return ft.Container(
            bgcolor=ft.Colors.SURFACE_CONTAINER_HIGHEST,
            border_radius=16,
            padding=16,
            width=220,
            content=ft.Column(
                [
                    ft.Row(
                        [
                            ft.Icon(icon, color=ft.Colors.PRIMARY),
                            ft.Text(label, color=ft.Colors.ON_SURFACE_VARIANT),
                        ],
                        spacing=8,
                    ),
                    ft.Text(value, size=24, weight=ft.FontWeight.BOLD),
                ],
                spacing=8,
                tight=True,
            ),
        )

    def overview_card(
        title: str,
        value: str,
        subtitle: str,
        icon: str,
        accent_color: str,
        col: dict | int | None = None,
    ) -> ft.Control:
        return ft.Card(
            elevation=0.2,
            col=col or {"xs": 12, "sm": 6, "lg": 4},
            content=ft.Container(
                padding=16,
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=18,
                bgcolor=ft.Colors.WHITE,
                content=ft.Column(
                    [
                        ft.Row(
                            [
                                ft.Icon(icon, color=accent_color, size=18),
                                ft.Text(title, size=12, color=ft.Colors.BLUE_GREY_500),
                            ],
                            spacing=8,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        ft.Text(
                            value,
                            size=24,
                            weight=ft.FontWeight.BOLD,
                            color=accent_color,
                        ),
                        ft.Text(
                            subtitle,
                            size=11,
                            color=ft.Colors.BLUE_GREY_500,
                        ),
                    ],
                    spacing=8,
                    tight=True,
                ),
            ),
        )

    def product_summary_card(product: dict, accent_color: str = ft.Colors.PRIMARY) -> ft.Control:
        return ft.Card(
            content=ft.Container(
                padding=16,
                content=ft.Column(
                    [
                        ft.Text(
                            product.get("product_name", "商品名未設定"),
                            size=20,
                            weight=ft.FontWeight.BOLD,
                            color=accent_color,
                        ),
                        ft.Text(f"JAN: {product.get('jan_code', '-')}", selectable=True),
                        ft.Row(
                            [
                                ft.Text(f"原価: ¥{int(product.get('cost_price', 0)):,}"),
                                ft.Text(f"売価: ¥{int(product.get('selling_price', 0)):,}"),
                                ft.Text(f"区分: {product.get('category', '-') or '-'}"),
                            ],
                            wrap=True,
                            run_spacing=8,
                        ),
                    ],
                    spacing=10,
                    tight=True,
                ),
            )
        )

    def empty_state(message: str, icon: str = ft.Icons.INVENTORY_2_OUTLINED) -> ft.Control:
        return ft.Container(
            padding=24,
            border_radius=16,
            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
            content=ft.Column(
                [
                    ft.Icon(icon, size=32, color=ft.Colors.ON_SURFACE_VARIANT),
                    ft.Text(
                        message,
                        color=ft.Colors.ON_SURFACE_VARIANT,
                        text_align=ft.TextAlign.CENTER,
                    ),
                ],
                horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                spacing=12,
                tight=True,
            ),
        )

    def refresh_history_date_buttons():
        history_from_btn.content = f"開始日: {state.history_date_from.strftime('%Y/%m/%d')}"
        history_to_btn.content = f"終了日: {state.history_date_to.strftime('%Y/%m/%d')}"

    def refresh_store_controls():
        from_store_dropdown.options = [
            ft.dropdown.Option(store["id"], store["name"]) for store in state.stores
        ]
        from_store_dropdown.value = state.from_store_id

        destinations = available_destination_stores(state.stores, state.from_store_id)
        if state.to_store_id not in {store["id"] for store in destinations}:
            state.to_store_id = destinations[0]["id"] if destinations else None
        to_store_dropdown.options = [
            ft.dropdown.Option(store["id"], store["name"]) for store in destinations
        ]
        to_store_dropdown.value = state.to_store_id

        filter_options = [ft.dropdown.Option(ALL_STORES, "全店舗")] + [
            ft.dropdown.Option(store["id"], store["name"]) for store in state.stores
        ]
        history_from_dropdown.options = filter_options
        history_to_dropdown.options = filter_options
        history_from_dropdown.value = state.history_from_store_id
        history_to_dropdown.value = state.history_to_store_id

        if not state.stores:
            current_store_text.value = "店舗マスタがまだ登録されていません。"
            store_setup_hint_text.value = "まず店舗マスタを登録すると、店舗間移動をそのまま運用に乗せられます。"
            store_setup_hint_text.color = ft.Colors.ERROR
        else:
            from_store_name = next(
                (store["name"] for store in state.stores if store["id"] == state.from_store_id),
                "未選択",
            )
            current_store_text.value = f"移動元店舗: {from_store_name}"
            store_setup_hint_text.value = "移動元と移動先を確認してから、JANコード検索またはカメラ読取で追加します。"
            store_setup_hint_text.color = ft.Colors.ON_SURFACE_VARIANT

    def render_inventory_overview():
        summary = summarize_transfer_items(state.transfer_list)
        current_store_name = next(
            (store["name"] for store in state.stores if store["id"] == state.from_store_id),
            "未選択",
        )
        inventory_overview_row.controls = [
            overview_card(
                "店舗状態",
                f"{len(state.stores)}店" if state.stores else "未登録",
                f"移動元: {current_store_name}" if state.stores else "商品管理から店舗を整備してください",
                ft.Icons.STOREFRONT,
                ft.Colors.BLUE_700,
            ),
            overview_card(
                "商品マスタ",
                f"{state.product_count:,}件",
                "検索・CSV取込・手動登録の基礎データです。",
                ft.Icons.INVENTORY_2,
                ft.Colors.TEAL_700,
            ),
            overview_card(
                "今回の移動リスト",
                f"{summary['product_count']}種 / {summary['total_quantity']}個" if state.transfer_list else "未登録",
                f"原価合計 ¥{summary['total_cost']:,}" if state.transfer_list else "追加するとここに集計が出ます",
                ft.Icons.LOCAL_SHIPPING_OUTLINED,
                ft.Colors.ORANGE_800,
            ),
        ]

    def render_lookup_panel():
        if state.selected_product:
            lookup_result_container.content = ft.Column(
                [
                    product_summary_card(state.selected_product),
                    ft.Row(
                        [
                            ft.Button(
                                content="移動リストに追加",
                                icon=ft.Icons.ADD_SHOPPING_CART,
                                on_click=add_selected_product,
                            ),
                        ],
                        wrap=True,
                    ),
                ],
                spacing=12,
            )
            return

        if state.lookup_missing and state.last_lookup_jan:
            lookup_result_container.content = ft.Column(
                [
                    ft.Container(
                        bgcolor=ft.Colors.ERROR_CONTAINER,
                        border_radius=16,
                        padding=16,
                        content=ft.Text(
                            f"JANコード {state.last_lookup_jan} は商品マスタ未登録です。今回の移動リストには手入力で追加できます。",
                            color=ft.Colors.ON_ERROR_CONTAINER,
                        ),
                    ),
                    manual_transfer_name,
                    ft.Row(
                        [manual_transfer_cost, manual_transfer_sell],
                        wrap=True,
                        run_spacing=12,
                    ),
                    ft.Button(
                        content="未登録商品として追加",
                        icon=ft.Icons.EDIT_NOTE,
                        on_click=add_manual_transfer_item,
                    ),
                ],
                spacing=12,
            )
            return

        lookup_result_container.content = empty_state(
            "JANコードを入力して商品を検索してください。",
            icon=ft.Icons.QR_CODE_SCANNER,
        )

    def render_transfer_list():
        summary = summarize_transfer_items(state.transfer_list)
        transfer_stats_row.controls = []
        if state.transfer_list:
            transfer_stats_row.controls = [
                metric_card("商品種類", f"{summary['product_count']}種", ft.Icons.CATEGORY),
                metric_card("合計数量", f"{summary['total_quantity']}個", ft.Icons.INVENTORY_2),
                metric_card("原価合計", f"¥{summary['total_cost']:,}", ft.Icons.PAID),
            ]

        commit_transfer_btn.disabled = not state.transfer_list
        commit_transfer_btn.content = (
            f"移動を登録する（{summary['total_quantity']}個）"
            if state.transfer_list
            else "移動を登録する"
        )
        clear_transfer_btn.disabled = not state.transfer_list
        render_inventory_overview()

        if not state.transfer_list:
            transfer_list_column.controls = [
                empty_state("JANコードを検索して移動リストに追加してください。")
            ]
            return

        cards: list[ft.Control] = []
        for index, item in enumerate(state.transfer_list):
            cards.append(
                ft.Card(
                    content=ft.Container(
                        padding=16,
                        content=ft.Column(
                            [
                                ft.Row(
                                    [
                                        ft.Column(
                                            [
                                                ft.Text(
                                                    item["product_name"],
                                                    size=18,
                                                    weight=ft.FontWeight.BOLD,
                                                ),
                                                ft.Text(f"JAN: {item['jan_code']}"),
                                                ft.Text(
                                                    f"原価 ¥{int(item['cost_price']):,} / 売価 ¥{int(item['selling_price']):,}"
                                                ),
                                            ],
                                            spacing=6,
                                            expand=True,
                                        ),
                                        ft.IconButton(
                                            icon=ft.Icons.DELETE_OUTLINE,
                                            tooltip="削除",
                                            on_click=lambda _, i=index: remove_transfer_item(i),
                                        ),
                                    ],
                                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                                ),
                                ft.Row(
                                    [
                                        ft.IconButton(
                                            icon=ft.Icons.REMOVE_CIRCLE_OUTLINE,
                                            on_click=lambda _, i=index: change_quantity(i, -1),
                                        ),
                                        ft.Text(
                                            f"数量 {item['quantity']}",
                                            size=16,
                                            weight=ft.FontWeight.BOLD,
                                        ),
                                        ft.IconButton(
                                            icon=ft.Icons.ADD_CIRCLE_OUTLINE,
                                            on_click=lambda _, i=index: change_quantity(i, 1),
                                        ),
                                        ft.Text(
                                            f"小計 ¥{int(item['cost_price']) * int(item['quantity']):,}",
                                            color=ft.Colors.PRIMARY,
                                        ),
                                    ],
                                    wrap=True,
                                    spacing=4,
                                ),
                            ],
                            spacing=12,
                            tight=True,
                        ),
                    )
                )
            )
        transfer_list_column.controls = cards

    def render_history():
        history_stats_row.controls = []
        if state.history_rows:
            total_quantity = sum(int(row["数量"]) for row in state.history_rows)
            total_cost = sum(int(row["原価合計"]) for row in state.history_rows)
            history_stats_row.controls = [
                metric_card("移動件数", f"{len(state.history_rows)}件", ft.Icons.HISTORY),
                metric_card("合計数量", f"{total_quantity}個", ft.Icons.INVENTORY_2),
                metric_card("原価合計", f"¥{total_cost:,}", ft.Icons.PAID),
            ]

        export_history_btn.disabled = not state.history_rows

        if not state.history_rows:
            history_list_column.controls = [
                empty_state("指定条件の移動履歴はありません。", icon=ft.Icons.HISTORY_TOGGLE_OFF)
            ]
            return

        cards: list[ft.Control] = []
        for row in state.history_rows:
            cards.append(
                ft.Card(
                    content=ft.Container(
                        padding=16,
                        content=ft.Column(
                            [
                                ft.Row(
                                    [
                                        ft.Text(
                                            row["商品名"] or "商品名未設定",
                                            size=18,
                                            weight=ft.FontWeight.BOLD,
                                        ),
                                        ft.Text(
                                            row["日付"] or "-",
                                            color=ft.Colors.ON_SURFACE_VARIANT,
                                        ),
                                    ],
                                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                                ),
                                ft.Text(f"{row['移動元']} → {row['移動先']}"),
                                ft.Row(
                                    [
                                        ft.Text(f"JAN: {row['JAN']}"),
                                        ft.Text(f"数量: {row['数量']}"),
                                        ft.Text(f"原価合計: ¥{int(row['原価合計']):,}"),
                                    ],
                                    wrap=True,
                                    run_spacing=8,
                                ),
                            ],
                            spacing=10,
                            tight=True,
                        ),
                    )
                )
            )
        history_list_column.controls = cards

    def render_products():
        product_count_value.value = f"{state.product_count:,}件"
        render_inventory_overview()

        if state.master_search_result:
            master_search_result_container.content = ft.Column(
                [
                    product_summary_card(state.master_search_result, accent_color=ft.Colors.TEAL),
                    ft.Row(
                        [
                            ft.OutlinedButton(
                                content="この商品を削除",
                                icon=ft.Icons.DELETE_OUTLINE,
                                on_click=lambda _: confirm_delete_product(state.master_search_result),
                            )
                        ],
                        wrap=True,
                    ),
                ],
                spacing=12,
            )
        elif (product_search_input.value or "").strip():
            master_search_result_container.content = empty_state(
                "該当する商品が見つかりませんでした。",
                icon=ft.Icons.SEARCH_OFF,
            )
        else:
            master_search_result_container.content = empty_state(
                "JANコードで既存商品を検索できます。",
                icon=ft.Icons.MANAGE_SEARCH,
            )

        product_rows = format_product_rows(state.products)
        if not product_rows:
            products_list_column.controls = [
                empty_state("商品マスタはまだ登録されていません。", icon=ft.Icons.INVENTORY)
            ]
            return

        cards: list[ft.Control] = []
        for row in product_rows:
            cards.append(
                ft.Card(
                    content=ft.Container(
                        padding=16,
                        content=ft.Column(
                            [
                                ft.Text(row["商品名"] or "商品名未設定", size=18, weight=ft.FontWeight.BOLD),
                                ft.Text(f"JAN: {row['JANコード']}", selectable=True),
                                ft.Row(
                                    [
                                        ft.Text(f"原価: ¥{int(row['原価']):,}"),
                                        ft.Text(f"売価: ¥{int(row['売価']):,}"),
                                        ft.Text(f"区分: {row['区分'] or '-'}"),
                                    ],
                                    wrap=True,
                                    run_spacing=8,
                                ),
                            ],
                            spacing=10,
                            tight=True,
                        ),
                    )
                )
            )
        products_list_column.controls = cards

    def refresh_all_views():
        refresh_history_date_buttons()
        refresh_store_controls()
        render_inventory_overview()
        render_lookup_panel()
        render_transfer_list()
        render_history()
        render_products()

    def load_history_data():
        try:
            from_store_id = (
                None
                if state.history_from_store_id == ALL_STORES
                else int(state.history_from_store_id)
            )
            to_store_id = (
                None if state.history_to_store_id == ALL_STORES else int(state.history_to_store_id)
            )
            rows = db.get_transfers(
                from_store_id=from_store_id,
                to_store_id=to_store_id,
                date_from=state.history_date_from.isoformat(),
                date_to=state.history_date_to.isoformat(),
            )
            state.history_rows = format_transfer_history(rows)
            render_history()
            set_status("移動履歴を更新しました。")
        except Exception as ex:
            state.history_rows = []
            render_history()
            set_status(f"移動履歴の取得に失敗しました: {ex}", ft.Colors.ERROR)
        page.update()

    def load_product_data():
        try:
            state.product_count = db.get_product_count()
            state.products = db.get_all_products(limit=100)
            render_products()
            set_status("商品マスタを更新しました。")
        except Exception as ex:
            state.product_count = 0
            state.products = []
            render_products()
            set_status(f"商品マスタの取得に失敗しました: {ex}", ft.Colors.ERROR)
        page.update()

    def load_initial_data():
        nonlocal pending_scanned_jan
        try:
            stores = normalize_store_records(db.get_stores())
            state.stores = stores
            if stores and not state.from_store_id:
                state.from_store_id = choose_default_from_store_id(stores)
            destinations = available_destination_stores(stores, state.from_store_id)
            if destinations and not state.to_store_id:
                state.to_store_id = destinations[0]["id"]

            state.product_count = db.get_product_count()
            state.products = db.get_all_products(limit=100)
            state.history_rows = format_transfer_history(
                db.get_transfers(
                    date_from=state.history_date_from.isoformat(),
                    date_to=state.history_date_to.isoformat(),
                )
            )

            refresh_all_views()
            set_status("店舗と商品データを読み込みました。")
            if pending_scanned_jan:
                jan_input.value = pending_scanned_jan
                search_transfer_product()
                scanned_jan = pending_scanned_jan
                pending_scanned_jan = ""
                set_status(f"カメラで読み取った JANコード {scanned_jan} を検索しました。")
                page.run_task(clear_scanned_jan_query)
        except Exception as ex:
            refresh_all_views()
            set_status(f"初期データの読み込みに失敗しました: {ex}", ft.Colors.ERROR)
        page.update()

    async def clear_scanned_jan_query():
        if getattr(page, "route", "") == "/inventory":
            await page.push_route("/inventory")

    def on_from_store_change(e):
        state.from_store_id = e.control.value
        refresh_store_controls()
        render_transfer_list()
        page.update()

    def on_to_store_change(e):
        state.to_store_id = e.control.value
        page.update()

    def on_history_store_change(e):
        state.history_from_store_id = history_from_dropdown.value or ALL_STORES
        state.history_to_store_id = history_to_dropdown.value or ALL_STORES

    def on_history_date_change(e):
        raw_value = getattr(e, "data", None)
        if raw_value:
            raw_text = str(raw_value).strip()
            try:
                if "T" in raw_text or " " in raw_text or raw_text.endswith("Z") or "+" in raw_text[10:]:
                    selected_value = datetime.fromisoformat(raw_text.replace("Z", "+00:00")).astimezone().date()
                else:
                    selected_value = date.fromisoformat(raw_text)
            except ValueError:
                selected_value = e.control.value.date() if hasattr(e.control.value, "date") else e.control.value
        else:
            selected_value = e.control.value.date() if hasattr(e.control.value, "date") else e.control.value
        if e.control.key == "inventory_history_from_picker" and selected_value:
            state.history_date_from = selected_value
        if e.control.key == "inventory_history_to_picker" and selected_value:
            state.history_date_to = selected_value
        if state.history_date_from > state.history_date_to:
            state.history_date_to = state.history_date_from
        refresh_history_date_buttons()
        page.update()

    def open_history_from_picker(e=None):
        picker = ft.DatePicker(
            key="inventory_history_from_picker",
            value=state.history_date_from,
            on_change=on_history_date_change,
        )
        page.show_dialog(picker)

    def open_history_to_picker(e=None):
        picker = ft.DatePicker(
            key="inventory_history_to_picker",
            value=state.history_date_to,
            on_change=on_history_date_change,
        )
        page.show_dialog(picker)

    def search_transfer_product(e=None):
        jan_code = (jan_input.value or "").strip()
        if not jan_code:
            show_dialog("入力エラー", "JANコードを入力してください。")
            return

        product = db.search_product_by_jan(jan_code)
        state.last_lookup_jan = jan_code
        state.selected_product = product
        state.lookup_missing = product is None
        manual_transfer_name.value = ""
        manual_transfer_cost.value = "0"
        manual_transfer_sell.value = "0"

        if product:
            set_status(f"JANコード {jan_code} の商品を見つけました。")
        else:
            set_status(
                f"JANコード {jan_code} は未登録でした。必要なら手入力で追加してください。",
                ft.Colors.ERROR,
            )

        render_lookup_panel()
        page.update()

    async def open_jan_scanner(e=None):
        scanner_url = build_web_asset_url(
            getattr(page, "url", ""),
            getattr(page, "route", ""),
            JAN_SCANNER_ASSET_URL,
        )
        await page.launch_url(scanner_url, web_popup_window_name="_self")

    def reset_lookup_fields():
        jan_input.value = ""
        quantity_input.value = "1"
        memo_input.value = ""
        manual_transfer_name.value = ""
        manual_transfer_cost.value = "0"
        manual_transfer_sell.value = "0"
        state.selected_product = None
        state.lookup_missing = False
        state.last_lookup_jan = ""
        render_lookup_panel()

    def add_selected_product(e):
        try:
            item = make_transfer_item(
                product=state.selected_product or {},
                quantity=parse_int_input(quantity_input.value, "数量", default=1),
                from_store_id=state.from_store_id,
                to_store_id=state.to_store_id,
                memo=memo_input.value or "",
            )
        except ValueError as ex:
            show_dialog("登録エラー", str(ex))
            return

        state.transfer_list.append(item)
        reset_lookup_fields()
        render_transfer_list()
        set_status(f"「{item['product_name']}」を移動リストに追加しました。")
        page.update()

    def add_manual_transfer_item(e):
        manual_name = (manual_transfer_name.value or "").strip()
        if not manual_name:
            show_dialog("入力エラー", "未登録商品の商品名を入力してください。")
            return

        try:
            product = {
                "jan_code": state.last_lookup_jan,
                "product_name": manual_name,
                "cost_price": parse_int_input(manual_transfer_cost.value, "原価"),
                "selling_price": parse_int_input(manual_transfer_sell.value, "売価"),
            }
            item = make_transfer_item(
                product=product,
                quantity=parse_int_input(quantity_input.value, "数量", default=1),
                from_store_id=state.from_store_id,
                to_store_id=state.to_store_id,
                memo=memo_input.value or "",
            )
        except ValueError as ex:
            show_dialog("登録エラー", str(ex))
            return

        state.transfer_list.append(item)
        reset_lookup_fields()
        render_transfer_list()
        set_status(f"未登録商品「{item['product_name']}」を移動リストに追加しました。")
        page.update()

    def change_quantity(index: int, delta: int):
        if index >= len(state.transfer_list):
            return
        current_quantity = int(state.transfer_list[index]["quantity"])
        next_quantity = max(1, current_quantity + delta)
        state.transfer_list[index]["quantity"] = next_quantity
        render_transfer_list()
        page.update()

    def remove_transfer_item(index: int):
        if index >= len(state.transfer_list):
            return
        removed = state.transfer_list.pop(index)
        render_transfer_list()
        set_status(f"「{removed['product_name']}」を移動リストから削除しました。")
        page.update()

    def clear_transfer_list(e=None):
        state.transfer_list = []
        render_transfer_list()
        set_status("移動リストを空にしました。")
        page.update()

    def run_commit_transfer():
        try:
            payload = prepare_transfer_payload(state.transfer_list)
            success = db.add_transfers_batch(payload)
            if not success:
                raise RuntimeError("移動データの保存に失敗しました。")

            item_count = len(state.transfer_list)
            state.transfer_list = []
            reset_lookup_fields()
            render_transfer_list()
            load_history_data()
            show_dialog("登録完了", f"{item_count}件の移動を登録しました。")
            set_status("移動登録が完了しました。")
        except Exception as ex:
            set_status(f"移動登録に失敗しました: {ex}", ft.Colors.ERROR)
            show_dialog("登録エラー", str(ex))
        page.update()

    def commit_transfer(e):
        if not state.transfer_list:
            show_dialog("登録エラー", "移動リストが空です。")
            return
        set_status("移動データを登録しています...")
        page.update()
        page.run_thread(run_commit_transfer)

    def refresh_history(e=None):
        set_status("移動履歴を読み込んでいます...")
        page.update()
        page.run_thread(load_history_data)

    def search_master_product(e=None):
        jan_code = (product_search_input.value or "").strip()
        state.master_search_result = db.search_product_by_jan(jan_code) if jan_code else None
        render_products()
        page.update()

    def save_product(e):
        jan_code = (product_jan_input.value or "").strip()
        product_name = (product_name_input.value or "").strip()
        if not jan_code or not product_name:
            show_dialog("入力エラー", "JANコードと商品名は必須です。")
            return

        try:
            cost_price = parse_int_input(product_cost_input.value, "原価")
            selling_price = parse_int_input(product_sell_input.value, "売価")
        except ValueError as ex:
            show_dialog("入力エラー", str(ex))
            return
        markup_rate = round(cost_price / selling_price, 4) if selling_price > 0 else 0
        success = db.add_or_update_product(
            {
                "jan_code": jan_code,
                "product_name": product_name,
                "cost_price": cost_price,
                "selling_price": selling_price,
                "category": (product_category_input.value or "").strip(),
                "markup_rate": markup_rate,
            }
        )

        if not success:
            show_dialog("保存エラー", "商品マスタの更新に失敗しました。")
            return

        product_jan_input.value = ""
        product_name_input.value = ""
        product_cost_input.value = "0"
        product_sell_input.value = "0"
        product_category_input.value = ""
        state.master_search_result = None
        set_status("商品マスタを更新しました。")
        page.run_thread(load_product_data)

    def close_dialog(dialog: ft.AlertDialog):
        page.pop_dialog()
        page.update()

    def delete_product(dialog: ft.AlertDialog, jan_code: str):
        close_dialog(dialog)
        if not jan_code:
            return
        if not db.delete_product(jan_code):
            show_dialog("削除エラー", "商品の削除に失敗しました。")
            return
        state.master_search_result = None
        product_search_input.value = ""
        set_status("商品を削除しました。")
        page.run_thread(load_product_data)

    def confirm_delete_product(product: Optional[dict]):
        if not product:
            return

        dialog = ft.AlertDialog(
            modal=True,
            title=ft.Text("商品を削除しますか"),
            content=ft.Text(
                f"「{product.get('product_name', '')}」を削除します。元に戻せません。"
            ),
            actions=[
                ft.TextButton(
                    "キャンセル",
                    on_click=lambda e: close_dialog(dialog),
                ),
                ft.TextButton(
                    "削除する",
                    on_click=lambda e, jan=product.get("jan_code", ""): delete_product(dialog, jan),
                ),
            ],
        )
        page.show_dialog(dialog)

    async def export_history_csv(e):
        if not state.history_rows:
            show_dialog("保存エラー", "保存する履歴データがありません。")
            return

        df = pd.DataFrame(
            [{key: value for key, value in row.items() if key != "_id"} for row in state.history_rows]
        )
        csv_bytes = df.to_csv(index=False).encode("utf-8-sig")

        picker = ft.FilePicker()
        save_path = await picker.save_file(
            dialog_title="移動履歴を保存",
            file_name=f"inventory_history_{state.history_date_from}_{state.history_date_to}.csv",
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
            show_dialog("保存完了", "CSVを保存しました。")
            return

        if save_path:
            Path(save_path).write_bytes(csv_bytes)
            show_dialog("保存完了", f"CSVを保存しました。\n{save_path}")

    def read_uploaded_csv(csv_bytes: bytes) -> pd.DataFrame:
        preview_columns = []
        detected_encoding = None
        for encoding in ("utf-8-sig", "utf-8", "cp932"):
            try:
                preview = pd.read_csv(io.BytesIO(csv_bytes), encoding=encoding, nrows=5)
                preview_columns = [str(column) for column in preview.columns]
                detected_encoding = encoding
                break
            except UnicodeDecodeError:
                continue
        if detected_encoding is None:
            raise ValueError("CSVの文字コードを判定できませんでした。")

        has_header = any(
            column in preview_columns
            for column in ("JANコード", "JAN", "商品名", "jan_code", "product_name")
        )
        if has_header:
            return pd.read_csv(io.BytesIO(csv_bytes), encoding=detected_encoding)
        return pd.read_csv(io.BytesIO(csv_bytes), encoding=detected_encoding, header=None)

    async def import_products_csv(e):
        picker = ft.FilePicker()
        selected_files = await picker.pick_files(
            dialog_title="商品CSVを選択",
            file_type=ft.FilePickerFileType.CUSTOM,
            allowed_extensions=["csv"],
            allow_multiple=False,
            with_data=True,
        )
        if not selected_files:
            return

        selected_file = selected_files[0]
        file_bytes = selected_file.bytes
        if file_bytes is None and selected_file.path:
            file_bytes = Path(selected_file.path).read_bytes()
        if file_bytes is None:
            show_dialog("読込エラー", "CSVファイルの内容を取得できませんでした。")
            return

        try:
            df = read_uploaded_csv(file_bytes)
            success_count, error_count = db.upsert_products_from_csv(df)
            set_status("CSVから商品マスタを更新しました。")
            show_dialog(
                "CSV取込完了",
                f"更新件数: {success_count}件\nエラー件数: {error_count}件",
            )
            page.run_thread(load_product_data)
        except Exception as ex:
            show_dialog("CSV取込エラー", str(ex))

    def on_tab_change(e):
        selected_index = int(e.data)
        if selected_index == 1:
            refresh_history()
        elif selected_index == 2:
            set_status("商品マスタを読み込んでいます...")
            page.update()
            page.run_thread(load_product_data)

    query_params = page.query.to_dict if hasattr(page, "query") else {}
    pending_scanned_jan = str(query_params.get("scanned_jan", "")).strip()

    status_text = ft.Text("店舗と商品データを読み込んでいます...")
    current_store_text = ft.Text("", weight=ft.FontWeight.BOLD)
    store_setup_hint_text = ft.Text("", color=ft.Colors.ON_SURFACE_VARIANT)
    inventory_overview_row = ft.ResponsiveRow(spacing={"xs": 10, "md": 12}, run_spacing=10)

    from_store_dropdown = ft.Dropdown(
        label="移動元店舗",
        width=260,
        on_select=on_from_store_change,
    )
    to_store_dropdown = ft.Dropdown(
        label="移動先店舗",
        width=260,
        on_select=on_to_store_change,
    )
    jan_input = ft.TextField(
        label="JANコード",
        hint_text="バーコードをスキャンまたは入力",
        prefix_icon=ft.Icons.QR_CODE_SCANNER,
        on_submit=search_transfer_product,
    )
    quantity_input = ft.TextField(label="数量", value="1", width=120)
    memo_input = ft.TextField(label="メモ", hint_text="任意", expand=True)
    manual_transfer_name = ft.TextField(label="商品名", hint_text="未登録商品の名前")
    manual_transfer_cost = ft.TextField(label="原価", value="0", width=160)
    manual_transfer_sell = ft.TextField(label="売価", value="0", width=160)
    lookup_result_container = ft.Container()
    transfer_stats_row = ft.Row(wrap=True, run_spacing=12, spacing=12)
    transfer_list_column = ft.Column(spacing=12)
    commit_transfer_btn = ft.Button(
        content="移動を登録する",
        icon=ft.Icons.SAVE_OUTLINED,
        on_click=commit_transfer,
        disabled=True,
    )
    search_transfer_btn = ft.Button(
        content="検索",
        icon=ft.Icons.SEARCH,
        on_click=search_transfer_product,
        width=140,
    )
    camera_scan_btn = ft.OutlinedButton(
        content="カメラで読む",
        icon=ft.Icons.CAMERA_ALT_OUTLINED,
        on_click=open_jan_scanner,
        visible=bool(getattr(page, "web", False)),
    )
    clear_transfer_btn = ft.OutlinedButton(
        content="リストを全消去",
        icon=ft.Icons.DELETE_SWEEP,
        on_click=clear_transfer_list,
        disabled=True,
    )

    history_from_btn = ft.OutlinedButton(
        content="開始日",
        icon=ft.Icons.CALENDAR_MONTH,
        on_click=open_history_from_picker,
    )
    history_to_btn = ft.OutlinedButton(
        content="終了日",
        icon=ft.Icons.CALENDAR_MONTH,
        on_click=open_history_to_picker,
    )
    history_from_dropdown = ft.Dropdown(label="移動元", width=220, on_select=on_history_store_change)
    history_to_dropdown = ft.Dropdown(label="移動先", width=220, on_select=on_history_store_change)
    history_stats_row = ft.Row(wrap=True, run_spacing=12, spacing=12)
    history_list_column = ft.Column(spacing=12)
    export_history_btn = ft.OutlinedButton(
        content="CSV保存",
        icon=ft.Icons.DOWNLOAD,
        disabled=True,
        on_click=export_history_csv,
    )

    product_count_value = ft.Text("0件", size=28, weight=ft.FontWeight.BOLD)
    product_jan_input = ft.TextField(label="JANコード *", hint_text="バーコードを入力")
    product_name_input = ft.TextField(label="商品名 *", hint_text="商品名を入力")
    product_cost_input = ft.TextField(label="原価", value="0")
    product_sell_input = ft.TextField(label="売価", value="0")
    product_category_input = ft.TextField(label="区分", hint_text="任意")
    product_search_input = ft.TextField(
        label="JANコードで検索",
        hint_text="既存商品を検索",
        on_submit=search_master_product,
    )
    master_search_result_container = ft.Container()
    products_list_column = ft.Column(spacing=12)

    appbar = ft.AppBar(
        leading=ft.Icon(ft.Icons.INVENTORY_2),
        leading_width=36,
        title_spacing=8,
        toolbar_height=52,
        title=ft.Text("商品管理", size=20, weight=ft.FontWeight.BOLD),
        actions=[
            ft.IconButton(
                icon=ft.Icons.REFRESH,
                tooltip="再読み込み",
                on_click=lambda _: page.run_thread(load_initial_data),
            ),
            ft.IconButton(
                icon=ft.Icons.LOGOUT,
                tooltip="ログアウト",
                on_click=logout,
            ),
        ],
        actions_padding=ft.padding.only(right=4),
    )

    product_count_card = metric_card("登録商品数", "0件", ft.Icons.STORE)
    product_count_card.content.controls[1] = product_count_value

    transfer_tab = ft.Column(
        [
            inventory_overview_row,
            ft.ResponsiveRow(
                [
                    ft.Container(
                        col={"xs": 12, "xl": 7},
                        content=ft.Column(
                            [
                                ft.Container(
                                    bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                                    border_radius=16,
                                    padding=16,
                                    content=ft.Column(
                                        [
                                            ft.Text("移動入力", size=22, weight=ft.FontWeight.BOLD),
                                            current_store_text,
                                            store_setup_hint_text,
                                            ft.Row(
                                                [from_store_dropdown, to_store_dropdown],
                                                wrap=True,
                                                run_spacing=12,
                                                spacing=12,
                                            ),
                                        ],
                                        spacing=12,
                                    ),
                                ),
                                ft.Container(
                                    bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                                    border_radius=16,
                                    padding=16,
                                    content=ft.Column(
                                        [
                                            ft.Text("商品スキャン", size=20, weight=ft.FontWeight.BOLD),
                                            ft.Text(
                                                "JANコードで検索し、見つかった商品をそのまま移動リストへ追加します。",
                                                size=11,
                                                color=ft.Colors.ON_SURFACE_VARIANT,
                                            ),
                                            jan_input,
                                            ft.Row(
                                                [quantity_input, search_transfer_btn, camera_scan_btn],
                                                wrap=True,
                                                run_spacing=12,
                                                spacing=12,
                                            ),
                                            memo_input,
                                            lookup_result_container,
                                        ],
                                        spacing=12,
                                    ),
                                ),
                            ],
                            spacing=16,
                        ),
                    ),
                    ft.Container(
                        col={"xs": 12, "xl": 5},
                        content=ft.Column(
                            [
                                ft.Container(content=transfer_stats_row),
                                ft.Container(
                                    bgcolor=ft.Colors.SURFACE_CONTAINER_LOWEST,
                                    border_radius=16,
                                    padding=16,
                                    content=ft.Column(
                                        [
                                            ft.Text("今回の移動リスト", size=20, weight=ft.FontWeight.BOLD),
                                            ft.Text(
                                                "追加した商品を確認して、そのまま一括で移動登録します。",
                                                size=11,
                                                color=ft.Colors.ON_SURFACE_VARIANT,
                                            ),
                                            transfer_list_column,
                                            ft.Row(
                                                [commit_transfer_btn, clear_transfer_btn],
                                                wrap=True,
                                                run_spacing=12,
                                                spacing=12,
                                            ),
                                        ],
                                        spacing=16,
                                    ),
                                ),
                            ],
                            spacing=16,
                        ),
                    ),
                ],
                spacing={"xs": 10, "md": 12},
                run_spacing=10,
            ),
        ],
        scroll=ft.ScrollMode.AUTO,
        expand=True,
        spacing=16,
    )

    history_tab = ft.Column(
        [
            ft.Text("移動履歴", size=22, weight=ft.FontWeight.BOLD),
            ft.Container(
                bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                border_radius=16,
                padding=16,
                content=ft.Column(
                    [
                        ft.Row(
                            [history_from_btn, history_to_btn],
                            wrap=True,
                            run_spacing=12,
                            spacing=12,
                        ),
                        ft.Row(
                            [history_from_dropdown, history_to_dropdown],
                            wrap=True,
                            run_spacing=12,
                            spacing=12,
                        ),
                        ft.Row(
                            [
                                ft.Button(
                                    content="履歴を更新",
                                    icon=ft.Icons.SEARCH,
                                    on_click=refresh_history,
                                ),
                                export_history_btn,
                            ],
                            wrap=True,
                            run_spacing=12,
                            spacing=12,
                        ),
                    ],
                    spacing=12,
                ),
            ),
            history_stats_row,
            history_list_column,
        ],
        scroll=ft.ScrollMode.AUTO,
        expand=True,
        spacing=16,
    )

    products_tab = ft.Column(
        [
            ft.Row(
                [
                    product_count_card,
                    ft.Button(
                        content="CSV取込",
                        icon=ft.Icons.UPLOAD_FILE,
                        on_click=import_products_csv,
                    ),
                ],
                wrap=True,
                run_spacing=12,
                spacing=12,
            ),
            ft.ResponsiveRow(
                [
                    ft.Container(
                        col={"xs": 12, "xl": 7},
                        content=ft.Container(
                            padding=16,
                            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                            border_radius=16,
                            content=ft.Column(
                                [
                                    ft.Text("商品を手動で登録", size=20, weight=ft.FontWeight.BOLD),
                                    ft.Text(
                                        "CSVに載っていない商品や暫定商品をすぐに登録できます。",
                                        size=11,
                                        color=ft.Colors.ON_SURFACE_VARIANT,
                                    ),
                                    ft.Row(
                                        [product_jan_input, product_name_input],
                                        wrap=True,
                                        run_spacing=12,
                                        spacing=12,
                                    ),
                                    ft.Row(
                                        [product_cost_input, product_sell_input, product_category_input],
                                        wrap=True,
                                        run_spacing=12,
                                        spacing=12,
                                    ),
                                    ft.Button(
                                        content="商品を登録",
                                        icon=ft.Icons.SAVE,
                                        on_click=save_product,
                                    ),
                                ],
                                spacing=12,
                            ),
                        ),
                    ),
                    ft.Container(
                        col={"xs": 12, "xl": 5},
                        content=ft.Container(
                            padding=16,
                            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                            border_radius=16,
                            content=ft.Column(
                                [
                                    ft.Text("商品検索", size=20, weight=ft.FontWeight.BOLD),
                                    ft.Text(
                                        "登録済み商品を JANコードで検索し、その場で確認や削除ができます。",
                                        size=11,
                                        color=ft.Colors.ON_SURFACE_VARIANT,
                                    ),
                                    ft.Row(
                                        [
                                            product_search_input,
                                            ft.Button(
                                                content="検索",
                                                icon=ft.Icons.SEARCH,
                                                on_click=search_master_product,
                                            ),
                                        ],
                                        wrap=True,
                                        run_spacing=12,
                                        spacing=12,
                                    ),
                                    master_search_result_container,
                                ],
                                spacing=12,
                            ),
                        ),
                    ),
                ],
                spacing={"xs": 10, "md": 12},
                run_spacing=10,
            ),
            ft.Text("登録済み商品一覧（最新100件）", size=20, weight=ft.FontWeight.BOLD),
            products_list_column,
        ],
        scroll=ft.ScrollMode.AUTO,
        expand=True,
        spacing=16,
    )

    tab_items = [
        ft.Tab(label="移動入力"),
        ft.Tab(label="移動履歴"),
        ft.Tab(label="商品マスタ"),
    ]
    tab_views = [
        ft.Container(content=transfer_tab, padding=12),
        ft.Container(content=history_tab, padding=12),
        ft.Container(content=products_tab, padding=12),
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
        on_change=on_tab_change,
        expand=True,
    )

    refresh_all_views()
    page.run_thread(load_initial_data)

    return ft.View(
        route="/inventory",
        appbar=appbar,
        controls=[
            ft.Container(
                content=tabs,
                padding=ft.padding.only(left=8, right=8, top=4, bottom=8),
                expand=True,
            )
        ],
        navigation_bar=get_navigation_bar(page, 1),
    )
