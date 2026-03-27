from __future__ import annotations

from datetime import datetime

import flet as ft
import pandas as pd

from flet_app.components.navigation import get_navigation_bar
from flet_app.core.customer_orders import db as customer_orders_db
from flet_app.core.customer_orders.view_model import ACTIVE_TAB_STATUSES, build_status_counts
from flet_app.core.data_service import get_product_sales_data
from flet_app.core.inventory import db as inventory_db
from flet_app.core.shift.data_io import load_shift_history_list
from flet_app.core.supabase_client import supabase


def _format_currency(value: float | int) -> str:
    return f"¥{int(value):,}"


def DashboardView(page: ft.Page):
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

    async def open_route(route: str):
        await page.push_route(route)

    def info_chip(label: str) -> ft.Control:
        return ft.Container(
            padding=ft.padding.symmetric(horizontal=10, vertical=6),
            border_radius=999,
            bgcolor=ft.Colors.with_opacity(0.14, ft.Colors.WHITE),
            content=ft.Text(
                label,
                size=11,
                color=ft.Colors.WHITE,
                weight=ft.FontWeight.W_600,
            ),
        )

    def metric_card(
        title: str,
        value: str,
        subtitle: str,
        icon: str,
        accent_color: str,
        col: dict | int | None = None,
    ) -> ft.Control:
        return ft.Card(
            elevation=0.2,
            col=col or {"xs": 12, "sm": 6, "lg": 3},
            content=ft.Container(
                padding=18,
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=18,
                bgcolor=ft.Colors.WHITE,
                content=ft.Column(
                    [
                        ft.Row(
                            [
                                ft.Container(
                                    width=38,
                                    height=38,
                                    border_radius=12,
                                    bgcolor=ft.Colors.with_opacity(0.12, accent_color),
                                    alignment=ft.Alignment(0, 0),
                                    content=ft.Icon(icon, color=accent_color, size=20),
                                ),
                                ft.Text(
                                    title,
                                    size=12,
                                    color=ft.Colors.BLUE_GREY_500,
                                ),
                            ],
                            spacing=10,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        ft.Text(
                            value,
                            size=28,
                            weight=ft.FontWeight.BOLD,
                            color=accent_color,
                        ),
                        ft.Text(
                            subtitle,
                            size=11,
                            color=ft.Colors.BLUE_GREY_500,
                        ),
                    ],
                    spacing=10,
                    tight=True,
                ),
            ),
        )

    def module_card(
        title: str,
        description: str,
        stat_lines: list[str],
        route: str,
        icon: str,
        accent_color: str,
    ) -> ft.Control:
        stats_controls = [
            ft.Text(line, size=11, color=ft.Colors.BLUE_GREY_600) for line in stat_lines if line
        ]
        if not stats_controls:
            stats_controls = [ft.Text("まだ表示できる集計はありません。", size=11, color=ft.Colors.BLUE_GREY_400)]

        return ft.Card(
            elevation=0.2,
            col={"xs": 12, "md": 6, "xl": 4},
            content=ft.Container(
                padding=18,
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=18,
                bgcolor=ft.Colors.WHITE,
                content=ft.Column(
                    [
                        ft.Row(
                            [
                                ft.Container(
                                    width=40,
                                    height=40,
                                    border_radius=12,
                                    bgcolor=ft.Colors.with_opacity(0.12, accent_color),
                                    alignment=ft.Alignment(0, 0),
                                    content=ft.Icon(icon, color=accent_color),
                                ),
                                ft.Text(title, size=18, weight=ft.FontWeight.BOLD),
                            ],
                            spacing=12,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        ft.Text(description, size=12, color=ft.Colors.BLUE_GREY_600),
                        ft.Column(stats_controls, spacing=4, tight=True),
                        ft.Row(
                            [
                                ft.TextButton(
                                    content=ft.Text("画面を開く"),
                                    icon=ft.Icons.ARROW_FORWARD,
                                    on_click=lambda e, target=route: page.run_task(open_route, target),
                                )
                            ],
                            alignment=ft.MainAxisAlignment.END,
                        ),
                    ],
                    spacing=12,
                ),
            ),
        )

    def alert_row(level: str, message: str) -> ft.Control:
        palette = {
            "warning": (ft.Colors.AMBER_50, ft.Colors.AMBER_900, ft.Icons.WARNING_AMBER_ROUNDED),
            "error": (ft.Colors.RED_50, ft.Colors.RED_900, ft.Icons.ERROR_OUTLINE),
            "info": (ft.Colors.BLUE_50, ft.Colors.BLUE_900, ft.Icons.INFO_OUTLINE),
            "success": (ft.Colors.GREEN_50, ft.Colors.GREEN_900, ft.Icons.CHECK_CIRCLE_OUTLINE),
        }
        bgcolor, color, icon = palette.get(
            level, (ft.Colors.BLUE_GREY_50, ft.Colors.BLUE_GREY_900, ft.Icons.INFO_OUTLINE)
        )
        return ft.Container(
            padding=ft.padding.symmetric(horizontal=14, vertical=12),
            border_radius=14,
            bgcolor=bgcolor,
            content=ft.Row(
                [
                    ft.Icon(icon, color=color, size=18),
                    ft.Text(message, color=color, size=12, expand=True),
                ],
                spacing=10,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
        )

    def section_card(title: str, subtitle: str, content: ft.Control) -> ft.Control:
        header_controls: list[ft.Control] = [
            ft.Text(title, size=20, weight=ft.FontWeight.BOLD),
        ]
        if subtitle:
            header_controls.append(ft.Text(subtitle, size=12, color=ft.Colors.BLUE_GREY_500))

        header_controls.append(content)

        return ft.Card(
            elevation=0.2,
            content=ft.Container(
                padding=20,
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=20,
                bgcolor=ft.Colors.WHITE,
                content=ft.Column(header_controls, spacing=14),
            ),
        )

    def build_store_chart_card(store_sales: pd.DataFrame) -> ft.Control:
        if store_sales.empty:
            content = ft.Container(
                padding=24,
                border_radius=16,
                bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                content=ft.Text(
                    "売上データがまだ少ないため、店舗別売上は表示されていません。",
                    size=12,
                    color=ft.Colors.BLUE_GREY_600,
                ),
            )
            return section_card("店舗別売上", "売上の偏りや主力店舗を確認します。", content)

        max_sales = max(float(store_sales["total_amount"].max()), 1.0)
        chart_rows: list[ft.Control] = []
        for row in store_sales.itertuples():
            sales_value = float(row.total_amount)
            chart_rows.append(
                ft.Column(
                    [
                        ft.Row(
                            [
                                ft.Text(str(row.store_name), size=12, weight=ft.FontWeight.W_600),
                                ft.Text(
                                    _format_currency(sales_value),
                                    size=12,
                                    color=ft.Colors.BLUE_GREY_600,
                                ),
                            ],
                            alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                        ),
                        ft.Container(
                            height=12,
                            border_radius=999,
                            bgcolor=ft.Colors.BLUE_GREY_50,
                            content=ft.Row(
                                [
                                    ft.Container(
                                        height=12,
                                        width=max((sales_value / max_sales) * 420, 14),
                                        border_radius=999,
                                        bgcolor=ft.Colors.BLUE_500,
                                    )
                                ],
                                spacing=0,
                            ),
                        ),
                    ],
                    spacing=6,
                )
            )

        return section_card(
            "店舗別売上",
            "どの店舗に売上が集まっているかをざっくり確認できます。",
            ft.Column(chart_rows, spacing=14),
        )

    def build_top_products_card(product_sales: pd.DataFrame) -> ft.Control:
        if product_sales.empty:
            content = ft.Container(
                padding=24,
                border_radius=16,
                bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
                content=ft.Text(
                    "商品別売上の集計がまだありません。",
                    size=12,
                    color=ft.Colors.BLUE_GREY_600,
                ),
            )
            return section_card("売れ筋商品", "売上上位の商品を確認します。", content)

        rows: list[ft.Control] = []
        for index, row in enumerate(product_sales.itertuples(), start=1):
            rows.append(
                ft.Container(
                    padding=ft.padding.symmetric(horizontal=12, vertical=10),
                    border_radius=14,
                    bgcolor=ft.Colors.BLUE_GREY_50 if index == 1 else ft.Colors.WHITE,
                    border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                    content=ft.Row(
                        [
                            ft.Container(
                                width=30,
                                height=30,
                                border_radius=999,
                                alignment=ft.Alignment(0, 0),
                                bgcolor=ft.Colors.BLUE_100 if index == 1 else ft.Colors.BLUE_GREY_100,
                                content=ft.Text(str(index), weight=ft.FontWeight.BOLD, size=12),
                            ),
                            ft.Text(
                                str(row.product_name),
                                expand=True,
                                size=13,
                                weight=ft.FontWeight.W_600,
                            ),
                            ft.Text(
                                _format_currency(row.total_amount),
                                size=12,
                                color=ft.Colors.BLUE_GREY_600,
                            ),
                        ],
                        spacing=12,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                )
            )

        return section_card(
            "売れ筋商品",
            "上位商品を見ながら、在庫移動や販促の判断につなげます。",
            ft.Column(rows, spacing=10),
        )

    def build_loading_state(message: str) -> list[ft.Control]:
        return [
            ft.Container(
                expand=True,
                padding=40,
                alignment=ft.Alignment(0, 0),
                content=ft.Column(
                    [
                        ft.ProgressRing(),
                        ft.Text(message, size=13, color=ft.Colors.BLUE_GREY_600),
                    ],
                    horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=12,
                    tight=True,
                ),
            )
        ]

    main_container = ft.Column(
        controls=build_loading_state("ダッシュボードを集計しています..."),
        spacing=18,
        scroll=ft.ScrollMode.AUTO,
        expand=True,
    )

    def render_dashboard():
        main_container.controls = build_loading_state("ダッシュボードを更新しています...")
        page.update()
        page.run_thread(load_data)

    def load_data():
        token = getattr(page, "access_token", None)
        last_sync_label = datetime.now().strftime("%Y/%m/%d %H:%M")
        alerts: list[tuple[str, str]] = []

        raw_data: list[dict] = []
        product_count = 0
        stores: list[dict] = []
        customer_orders: list[dict] = []
        shift_history: list[dict] = []

        try:
            raw_data = get_product_sales_data(token, limit=5000)
        except Exception as ex:
            alerts.append(("error", f"売上データの取得に失敗しました: {ex}"))

        try:
            stores = inventory_db.get_stores()
        except Exception as ex:
            alerts.append(("error", f"店舗マスタの取得に失敗しました: {ex}"))

        try:
            product_count = inventory_db.get_product_count()
        except Exception as ex:
            alerts.append(("error", f"商品マスタ件数の取得に失敗しました: {ex}"))

        try:
            customer_orders = customer_orders_db.list_customer_orders(None, 500)
        except Exception as ex:
            alerts.append(("error", f"客注管理データの取得に失敗しました: {ex}"))

        try:
            shift_history = load_shift_history_list()
        except Exception as ex:
            alerts.append(("error", f"シフト履歴の読込に失敗しました: {ex}"))

        df = pd.DataFrame(raw_data)
        if df.empty:
            df = pd.DataFrame(columns=["store_name", "product_name", "total_amount", "transaction_date"])

        if "total_amount" not in df.columns:
            df["total_amount"] = 0
        if "store_name" not in df.columns:
            df["store_name"] = ""
        if "product_name" not in df.columns:
            df["product_name"] = ""
        if "transaction_date" not in df.columns:
            df["transaction_date"] = ""

        df["total_amount"] = pd.to_numeric(df["total_amount"], errors="coerce").fillna(0)
        df["store_name"] = df["store_name"].fillna("").replace("", "店舗未設定")
        df["product_name"] = df["product_name"].fillna("").replace("", "商品未設定")

        total_sales = float(df["total_amount"].sum())
        store_sales = (
            df.groupby("store_name", dropna=False)["total_amount"]
            .sum()
            .reset_index()
            .sort_values(by="total_amount", ascending=False)
        )
        product_sales = (
            df.groupby("product_name", dropna=False)["total_amount"]
            .sum()
            .reset_index()
            .sort_values(by="total_amount", ascending=False)
            .head(8)
        )

        latest_sales_label = "-"
        if not df.empty and df["transaction_date"].astype(str).str.strip().any():
            parsed_dates = pd.to_datetime(df["transaction_date"], errors="coerce", utc=True)
            valid_dates = parsed_dates.dropna()
            if not valid_dates.empty:
                latest_sales_label = valid_dates.max().strftime("%Y/%m/%d %H:%M")

        counts = build_status_counts(customer_orders)
        active_order_count = sum(counts.get(status, 0) for status in ACTIVE_TAB_STATUSES)
        completed_order_count = counts.get("completed", 0)
        cancelled_order_count = counts.get("cancelled", 0)
        store_count = len(stores) if stores else int(store_sales.shape[0])
        shift_history_count = len(shift_history)

        if not raw_data:
            alerts.append(("info", "売上データがまだ少ないため、売上指標は限定表示です。"))
        if not stores:
            alerts.append(("warning", "店舗マスタが未登録です。商品管理から先に店舗を整備すると運用しやすくなります。"))
        if product_count == 0:
            alerts.append(("warning", "商品マスタが未登録です。JAN検索や移動登録の前に商品データを用意してください。"))
        if active_order_count > 0:
            alerts.append(("info", f"進行中の客注が {active_order_count}件あります。客注管理で優先対応を確認してください。"))
        if shift_history_count == 0:
            alerts.append(("info", "シフト生成履歴はまだありません。初回の生成条件を確認して保存できます。"))
        if not alerts:
            alerts.append(("success", "大きな警告はありません。今日の業務状況は安定しています。"))

        hero_banner = ft.Container(
            padding=24,
            border_radius=24,
            bgcolor=ft.Colors.BLUE_GREY_900,
            content=ft.ResponsiveRow(
                [
                    ft.Container(
                        col={"xs": 12, "lg": 8},
                        content=ft.Column(
                            [
                                ft.Text(
                                    "社内ダッシュボード",
                                    size=30,
                                    weight=ft.FontWeight.BOLD,
                                    color=ft.Colors.WHITE,
                                ),
                                ft.Text(
                                    "売上・在庫・シフト・客注の状況をまとめて確認し、次の作業へすぐ移れるホーム画面です。",
                                    size=13,
                                    color=ft.Colors.BLUE_GREY_100,
                                ),
                                ft.Row(
                                    [
                                        info_chip("売上サマリー"),
                                        info_chip("在庫確認"),
                                        info_chip("シフト確認"),
                                        info_chip("客注対応"),
                                    ],
                                    wrap=True,
                                    spacing=8,
                                    run_spacing=8,
                                ),
                            ],
                            spacing=14,
                            tight=True,
                        ),
                    ),
                    ft.Container(
                        col={"xs": 12, "lg": 4},
                        content=ft.Container(
                            padding=16,
                            border_radius=18,
                            bgcolor=ft.Colors.with_opacity(0.12, ft.Colors.WHITE),
                            content=ft.Column(
                                [
                                    ft.Text("最終更新", size=11, color=ft.Colors.BLUE_GREY_100),
                                    ft.Text(
                                        last_sync_label,
                                        size=22,
                                        color=ft.Colors.WHITE,
                                        weight=ft.FontWeight.BOLD,
                                    ),
                                    ft.Text(
                                        f"売上反映: {latest_sales_label}",
                                        size=12,
                                        color=ft.Colors.BLUE_GREY_100,
                                    ),
                                ],
                                spacing=8,
                                tight=True,
                            ),
                        ),
                    ),
                ],
                spacing=12,
                run_spacing=12,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
        )

        metrics = ft.ResponsiveRow(
            [
                metric_card(
                    "売上合計",
                    _format_currency(total_sales),
                    "現在取得できている売上データの合計",
                    ft.Icons.PAID,
                    ft.Colors.BLUE_700,
                ),
                metric_card(
                    "店舗数",
                    f"{store_count}店",
                    "商品管理または売上データから把握できる店舗数",
                    ft.Icons.STOREFRONT,
                    ft.Colors.TEAL_700,
                ),
                metric_card(
                    "進行中の客注",
                    f"{active_order_count}件",
                    f"完了 {completed_order_count}件 / キャンセル {cancelled_order_count}件",
                    ft.Icons.ASSIGNMENT,
                    ft.Colors.ORANGE_800,
                ),
                metric_card(
                    "商品マスタ",
                    f"{product_count}件",
                    f"シフト履歴 {shift_history_count}件",
                    ft.Icons.INVENTORY_2,
                    ft.Colors.DEEP_PURPLE_700,
                ),
            ],
            spacing={"xs": 10, "md": 12},
            run_spacing=10,
        )

        alert_controls = ft.Column([alert_row(level, message) for level, message in alerts], spacing=10)
        quick_actions = ft.ResponsiveRow(
            [
                module_card(
                    "商品管理",
                    "店舗間移動、商品スキャン、商品マスタ更新をまとめます。",
                    [
                        f"店舗マスタ: {len(stores)}店" if stores else "店舗マスタ: 未登録",
                        f"商品マスタ: {product_count}件",
                    ],
                    "/inventory",
                    ft.Icons.INVENTORY_2,
                    ft.Colors.BLUE_700,
                ),
                module_card(
                    "シフト管理",
                    "期間設定、スタッフ編集、自動生成、履歴確認を行います。",
                    [
                        f"保存済み履歴: {shift_history_count}件",
                        "曜日別目標や優先曜日の調整が可能",
                    ],
                    "/shift",
                    ft.Icons.CALENDAR_MONTH,
                    ft.Colors.TEAL_700,
                ),
                module_card(
                    "客注管理",
                    "未発注からお渡し完了までを状態順に追跡します。",
                    [
                        f"進行中: {active_order_count}件",
                        f"完了: {completed_order_count}件 / キャンセル: {cancelled_order_count}件",
                    ],
                    "/customer-orders",
                    ft.Icons.ASSIGNMENT,
                    ft.Colors.ORANGE_800,
                ),
            ],
            spacing={"xs": 10, "md": 12},
            run_spacing=10,
        )

        sales_panels = ft.ResponsiveRow(
            [
                ft.Container(
                    col={"xs": 12, "xl": 6},
                    content=build_store_chart_card(store_sales),
                ),
                ft.Container(
                    col={"xs": 12, "xl": 6},
                    content=build_top_products_card(product_sales),
                ),
            ],
            spacing={"xs": 10, "md": 12},
            run_spacing=10,
        )

        main_container.controls = [
            hero_banner,
            metrics,
            section_card(
                "今日の注目",
                "まず確認しておきたい業務メモとアラートを表示します。",
                alert_controls,
            ),
            section_card(
                "業務ショートカット",
                "よく使う画面へ状況を見ながらすぐ移動できます。",
                quick_actions,
            ),
            sales_panels,
        ]
        page.update()

    appbar = ft.AppBar(
        leading=ft.Icon(ft.Icons.DASHBOARD),
        leading_width=40,
        title=ft.Text("社内ダッシュボード"),
        center_title=False,
        bgcolor=ft.Colors.SURFACE_CONTAINER_HIGHEST,
        actions=[
            ft.IconButton(ft.Icons.REFRESH, on_click=render_dashboard, tooltip="更新"),
            ft.IconButton(ft.Icons.LOGOUT, on_click=logout, tooltip="ログアウト"),
        ],
    )

    page.run_thread(load_data)

    content = ft.Container(
        content=main_container,
        padding=18,
        expand=True,
    )

    return ft.View(
        route="/dashboard",
        controls=[content],
        appbar=appbar,
        navigation_bar=get_navigation_bar(page, selected_index=0),
    )
