from __future__ import annotations

import base64
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import flet as ft

from flet_app.components.navigation import get_navigation_bar
from flet_app.core.auth_session import logout_page
from flet_app.core.data_service import get_product_sales_data
from flet_app.core.inventory import db as inventory_db
from flet_app.core.sales.view_model import (
    build_abc_analysis,
    build_category_breakdown,
    build_daily_breakdown,
    build_product_breakdown,
    build_sales_summary,
    build_store_breakdown,
    build_unmatched_breakdown,
    enrich_sales_records,
    filter_sales_records,
)


ALL_STORES = "すべて"
CHART_COLORS = [
    "#2563eb",
    "#0f766e",
    "#f97316",
    "#7c3aed",
    "#dc2626",
    "#0ea5e9",
    "#84cc16",
    "#f59e0b",
]


@dataclass
class SalesState:
    all_rows: list[dict] = field(default_factory=list)
    filtered_rows: list[dict] = field(default_factory=list)
    available_stores: list[str] = field(default_factory=lambda: [ALL_STORES])
    loading: bool = True
    error_messages: list[str] = field(default_factory=list)
    date_from: date | None = None
    date_to: date | None = None
    min_date: date = field(default_factory=date.today)
    max_date: date = field(default_factory=date.today)
    last_sync_label: str = "-"
    latest_sales_label: str = "-"


def _format_currency(value: int | float) -> str:
    return f"¥{int(value):,}"


def _format_number(value: int | float) -> str:
    return f"{int(value):,}"


def _format_percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def _to_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def SalesView(page: ft.Page):
    state = SalesState()

    search_field = ft.TextField(
        label="商品名・JAN・カテゴリ検索",
        hint_text="例: 犬 / 4520 / おやつ",
        prefix_icon=ft.Icons.SEARCH,
        on_submit=lambda e: apply_filters(),
        expand=True,
    )
    store_dropdown = ft.Dropdown(
        label="店舗",
        value=ALL_STORES,
        options=[ft.dropdown.Option(ALL_STORES)],
        width=220,
        on_change=lambda e: apply_filters(),
    )
    period_summary_text = ft.Text(size=13, weight=ft.FontWeight.W_600)
    filter_status_text = ft.Text(color=ft.Colors.BLUE_GREY_600, size=12)

    main_container = ft.Column(
        spacing=16,
        expand=True,
        scroll=ft.ScrollMode.AUTO,
    )

    async def logout(e):
        await logout_page(page)
        await page.push_route("/login")

    def section_card(title: str, subtitle: str, content: ft.Control) -> ft.Control:
        header: list[ft.Control] = [ft.Text(title, size=18, weight=ft.FontWeight.BOLD)]
        if subtitle:
            header.append(ft.Text(subtitle, size=12, color=ft.Colors.BLUE_GREY_600))
        header.append(content)
        return ft.Card(
            elevation=0.2,
            content=ft.Container(
                padding=18,
                border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                border_radius=18,
                bgcolor=ft.Colors.WHITE,
                content=ft.Column(header, spacing=12, tight=True),
            ),
        )

    def metric_card(
        title: str,
        value: str,
        subtitle: str,
        icon: str,
        accent: str,
    ) -> ft.Control:
        return ft.Card(
            elevation=0.2,
            col={"xs": 12, "sm": 6, "xl": 2.4},
            content=ft.Container(
                padding=16,
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
                                    bgcolor=ft.Colors.with_opacity(0.12, accent),
                                    alignment=ft.Alignment(0, 0),
                                    content=ft.Icon(icon, color=accent, size=20),
                                ),
                                ft.Text(title, size=12, color=ft.Colors.BLUE_GREY_500),
                            ],
                            spacing=10,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        ft.Text(value, size=26, weight=ft.FontWeight.BOLD, color=accent),
                        ft.Text(subtitle, size=11, color=ft.Colors.BLUE_GREY_500),
                    ],
                    spacing=8,
                    tight=True,
                ),
            ),
        )

    def build_placeholder(message: str) -> ft.Control:
        return ft.Container(
            padding=24,
            border_radius=16,
            bgcolor=ft.Colors.SURFACE_CONTAINER_LOW,
            content=ft.Text(message, color=ft.Colors.BLUE_GREY_600),
        )

    def build_legend(rows: list[dict], label_key: str, value_key: str) -> ft.Control:
        legend_items: list[ft.Control] = []
        total_value = sum(int(row.get(value_key, 0)) for row in rows) or 1
        for index, row in enumerate(rows):
            color = CHART_COLORS[index % len(CHART_COLORS)]
            value = int(row.get(value_key, 0))
            label = str(row.get(label_key, "-"))
            legend_items.append(
                ft.Row(
                    [
                        ft.Container(width=12, height=12, border_radius=999, bgcolor=color),
                        ft.Text(label, expand=True, size=12, weight=ft.FontWeight.W_600),
                        ft.Text(_format_currency(value), size=12),
                        ft.Text(
                            _format_percent(value / total_value),
                            size=11,
                            color=ft.Colors.BLUE_GREY_500,
                        ),
                    ],
                    spacing=10,
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                )
            )
        return ft.Column(legend_items, spacing=8, tight=True)

    def build_donut_chart_src(rows: list[dict], value_key: str) -> str:
        total_value = sum(int(row.get(value_key, 0)) for row in rows)
        if total_value <= 0:
            return ""

        radius = 64
        circumference = 2 * math.pi * radius
        dash_offset = 0.0
        segments: list[str] = []

        for index, row in enumerate(rows):
            value = int(row.get(value_key, 0))
            if value <= 0:
                continue
            color = CHART_COLORS[index % len(CHART_COLORS)]
            dash_length = circumference * (value / total_value)
            segments.append(
                (
                    f'<circle cx="100" cy="100" r="{radius}" fill="none" stroke="{color}" '
                    f'stroke-width="26" stroke-dasharray="{dash_length:.2f} {circumference:.2f}" '
                    f'stroke-dashoffset="-{dash_offset:.2f}" transform="rotate(-90 100 100)" />'
                )
            )
            dash_offset += dash_length

        svg = (
            "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'>"
            "<circle cx='100' cy='100' r='64' fill='none' stroke='#e2e8f0' stroke-width='26' />"
            f"{''.join(segments)}"
            "<circle cx='100' cy='100' r='44' fill='white' />"
            "</svg>"
        )
        encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return f"data:image/svg+xml;base64,{encoded}"

    def build_bar_chart(
        rows: list[dict],
        *,
        label_key: str,
        value_key: str,
        value_formatter,
        empty_message: str,
    ) -> ft.Control:
        if not rows:
            return build_placeholder(empty_message)

        max_value = max(int(row.get(value_key, 0)) for row in rows) or 1
        controls: list[ft.Control] = []
        for index, row in enumerate(rows):
            color = CHART_COLORS[index % len(CHART_COLORS)]
            value = int(row.get(value_key, 0))
            width_ratio = max(value / max_value, 0.04)
            controls.append(
                ft.Column(
                    [
                        ft.Row(
                            [
                                ft.Text(str(row.get(label_key, "-")), weight=ft.FontWeight.W_600, expand=True),
                                ft.Text(value_formatter(value), color=ft.Colors.BLUE_GREY_600, size=12),
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
                                        width=max(18, 420 * width_ratio),
                                        border_radius=999,
                                        bgcolor=color,
                                    )
                                ],
                                spacing=0,
                            ),
                        ),
                    ],
                    spacing=6,
                    tight=True,
                )
            )
        return ft.Column(controls, spacing=12, tight=True)

    def build_ranked_rows(
        rows: list[dict],
        *,
        label_key: str,
        amount_key: str,
        right_secondary_key: str,
        right_secondary_label: str,
        empty_message: str,
        badge_key: str | None = None,
    ) -> ft.Control:
        if not rows:
            return build_placeholder(empty_message)

        controls: list[ft.Control] = []
        for index, row in enumerate(rows, start=1):
            badge_value = str(row.get(badge_key, "")) if badge_key else ""
            badge = (
                ft.Container(
                    padding=ft.padding.symmetric(horizontal=8, vertical=4),
                    border_radius=999,
                    bgcolor=ft.Colors.BLUE_50 if badge_value == "A" else ft.Colors.AMBER_50 if badge_value == "B" else ft.Colors.BLUE_GREY_100,
                    content=ft.Text(badge_value, size=11, weight=ft.FontWeight.W_600),
                )
                if badge_value
                else ft.Container(width=0)
            )
            controls.append(
                ft.Container(
                    padding=ft.padding.symmetric(horizontal=12, vertical=10),
                    border_radius=14,
                    border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                    bgcolor=ft.Colors.WHITE if index > 1 else ft.Colors.BLUE_GREY_50,
                    content=ft.Row(
                        [
                            ft.Container(
                                width=28,
                                height=28,
                                border_radius=999,
                                bgcolor=ft.Colors.BLUE_100 if index == 1 else ft.Colors.BLUE_GREY_100,
                                alignment=ft.Alignment(0, 0),
                                content=ft.Text(str(index), size=12, weight=ft.FontWeight.BOLD),
                            ),
                            ft.Column(
                                [
                                    ft.Text(str(row.get(label_key, "-")), weight=ft.FontWeight.W_600, expand=True),
                                    ft.Text(
                                        f"{right_secondary_label}: {_format_number(int(row.get(right_secondary_key, 0)))}",
                                        size=11,
                                        color=ft.Colors.BLUE_GREY_500,
                                    ),
                                ],
                                spacing=3,
                                tight=True,
                                expand=True,
                            ),
                            badge,
                            ft.Text(
                                _format_currency(int(row.get(amount_key, 0))),
                                size=12,
                                color=ft.Colors.BLUE_GREY_700,
                            ),
                        ],
                        spacing=10,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                )
            )
        return ft.Column(controls, spacing=10, tight=True)

    def update_filter_summary():
        start_label = state.date_from.strftime("%Y/%m/%d") if state.date_from else "-"
        end_label = state.date_to.strftime("%Y/%m/%d") if state.date_to else "-"
        period_summary_text.value = f"{start_label} 〜 {end_label}"
        filter_status_text.value = (
            f"{_format_number(len(state.filtered_rows))}件 / 全{_format_number(len(state.all_rows))}件を表示"
        )
        search_field.value = search_field.value or ""
        store_dropdown.value = store_dropdown.value or ALL_STORES

    def open_period_picker(e=None):
        picker = ft.DateRangePicker(
            modal=True,
            start_value=state.date_from or state.min_date,
            end_value=state.date_to or state.max_date,
            first_date=state.min_date - timedelta(days=365),
            last_date=state.max_date + timedelta(days=365),
            save_text="適用",
            cancel_text="閉じる",
            field_start_label_text="開始日",
            field_end_label_text="終了日",
            help_text="集計期間を選択",
            on_change=lambda evt: apply_period(picker.start_value, picker.end_value),
        )
        page.show_dialog(picker)
        page.update()

    def apply_period(start_value, end_value):
        state.date_from = _to_date(start_value) or state.min_date
        state.date_to = _to_date(end_value) or state.max_date
        apply_filters()

    def set_quick_range(days: int | None):
        if not state.all_rows:
            return
        if days is None:
            state.date_from = state.min_date
            state.date_to = state.max_date
        else:
            state.date_to = state.max_date
            state.date_from = max(state.min_date, state.max_date - timedelta(days=days - 1))
        apply_filters()

    def reset_filters(e=None):
        search_field.value = ""
        store_dropdown.value = ALL_STORES
        if state.all_rows:
            state.date_from = max(state.min_date, state.max_date - timedelta(days=29))
            state.date_to = state.max_date
        apply_filters()

    def apply_filters(e=None):
        state.filtered_rows = filter_sales_records(
            state.all_rows,
            date_from=state.date_from,
            date_to=state.date_to,
            search_query=search_field.value or "",
            store_name=store_dropdown.value or ALL_STORES,
        )
        render_body()

    def render_loading(message: str):
        main_container.controls = [
            ft.Container(
                expand=True,
                padding=40,
                alignment=ft.Alignment(0, 0),
                content=ft.Column(
                    [
                        ft.ProgressRing(),
                        ft.Text(message, color=ft.Colors.BLUE_GREY_600),
                    ],
                    horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=12,
                    tight=True,
                ),
            )
        ]
        page.update()

    def render_body():
        update_filter_summary()

        summary = build_sales_summary(state.filtered_rows)
        product_rows = build_product_breakdown(state.filtered_rows, limit=10)
        abc_rows = build_abc_analysis(state.filtered_rows)[:10]
        category_rows = build_category_breakdown(state.filtered_rows)[:6]
        store_rows = build_store_breakdown(state.filtered_rows)[:6]
        daily_rows = build_daily_breakdown(state.filtered_rows)[-12:]
        unmatched_rows = build_unmatched_breakdown(state.filtered_rows)[:8]
        unmatched_count = len(build_unmatched_breakdown(state.filtered_rows))

        messages = list(state.error_messages)
        if unmatched_count:
            messages.append(
                f"商品マスタ未紐付けが {unmatched_count}件あります。商品名の表記揺れやCSVマスタを確認してください。"
            )
        if not state.filtered_rows:
            messages.append("該当する売上データがありません。期間や検索条件を見直してください。")

        message_controls = [
            ft.Container(
                padding=ft.padding.symmetric(horizontal=14, vertical=12),
                border_radius=14,
                bgcolor=ft.Colors.AMBER_50 if "未紐付け" in message else ft.Colors.BLUE_50,
                content=ft.Text(message, color=ft.Colors.BLUE_GREY_900, size=12),
            )
            for message in messages
        ]

        hero = ft.Container(
            padding=22,
            border_radius=22,
            bgcolor=ft.Colors.BLUE_GREY_900,
            content=ft.ResponsiveRow(
                [
                    ft.Container(
                        col={"xs": 12, "lg": 8},
                        content=ft.Column(
                            [
                                ft.Text("売上管理", size=30, weight=ft.FontWeight.BOLD, color=ft.Colors.WHITE),
                                ft.Text(
                                    "期間・店舗・商品で絞り込みながら、販売数、ABC分析、カテゴリ構成、未紐付け商品までまとめて確認できます。",
                                    size=13,
                                    color=ft.Colors.BLUE_GREY_100,
                                ),
                                ft.Row(
                                    [
                                        ft.Container(
                                            padding=ft.padding.symmetric(horizontal=10, vertical=6),
                                            border_radius=999,
                                            bgcolor=ft.Colors.with_opacity(0.14, ft.Colors.WHITE),
                                            content=ft.Text(period_summary_text.value, size=11, color=ft.Colors.WHITE),
                                        ),
                                        ft.Container(
                                            padding=ft.padding.symmetric(horizontal=10, vertical=6),
                                            border_radius=999,
                                            bgcolor=ft.Colors.with_opacity(0.14, ft.Colors.WHITE),
                                            content=ft.Text(
                                                f"表示件数 {_format_number(len(state.filtered_rows))}",
                                                size=11,
                                                color=ft.Colors.WHITE,
                                            ),
                                        ),
                                        ft.Container(
                                            padding=ft.padding.symmetric(horizontal=10, vertical=6),
                                            border_radius=999,
                                            bgcolor=ft.Colors.with_opacity(0.14, ft.Colors.WHITE),
                                            content=ft.Text(
                                                f"最終売上日 {state.latest_sales_label}",
                                                size=11,
                                                color=ft.Colors.WHITE,
                                            ),
                                        ),
                                    ],
                                    spacing=8,
                                    run_spacing=8,
                                    wrap=True,
                                ),
                            ],
                            spacing=12,
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
                                    ft.Text(state.last_sync_label, size=22, weight=ft.FontWeight.BOLD, color=ft.Colors.WHITE),
                                    ft.Text(filter_status_text.value, size=12, color=ft.Colors.BLUE_GREY_100),
                                ],
                                spacing=8,
                                tight=True,
                            ),
                        ),
                    ),
                ],
                spacing=12,
                run_spacing=12,
            ),
        )

        filter_panel = section_card(
            "絞り込み",
            "集計期間、店舗、商品検索を組み合わせて必要な売上だけを表示します。",
            ft.Column(
                [
                    ft.ResponsiveRow(
                        [
                            ft.Container(col={"xs": 12, "lg": 6}, content=search_field),
                            ft.Container(col={"xs": 12, "sm": 6, "lg": 3}, content=store_dropdown),
                            ft.Container(
                                col={"xs": 12, "sm": 6, "lg": 3},
                                content=ft.Container(
                                    padding=14,
                                    border_radius=14,
                                    border=ft.border.all(1, ft.Colors.BLUE_GREY_100),
                                    content=ft.Column(
                                        [
                                            ft.Text("集計期間", size=11, color=ft.Colors.BLUE_GREY_500),
                                            period_summary_text,
                                        ],
                                        spacing=4,
                                        tight=True,
                                    ),
                                ),
                            ),
                        ],
                        spacing=12,
                        run_spacing=12,
                    ),
                    ft.Row(
                        [
                            ft.ElevatedButton("検索を適用", icon=ft.Icons.SEARCH, on_click=apply_filters),
                            ft.OutlinedButton("期間を選ぶ", icon=ft.Icons.DATE_RANGE, on_click=open_period_picker),
                            ft.TextButton("直近7日", on_click=lambda e: set_quick_range(7)),
                            ft.TextButton("直近30日", on_click=lambda e: set_quick_range(30)),
                            ft.TextButton("全期間", on_click=lambda e: set_quick_range(None)),
                            ft.TextButton("リセット", on_click=reset_filters),
                        ],
                        spacing=8,
                        wrap=True,
                        run_spacing=8,
                    ),
                ],
                spacing=12,
                tight=True,
            ),
        )

        metrics = ft.ResponsiveRow(
            [
                metric_card("売上金額", _format_currency(summary["total_amount"]), "対象期間の売上合計", ft.Icons.PAID, ft.Colors.BLUE_700),
                metric_card("販売数", f"{_format_number(summary['total_quantity'])}点", "数量ベースの販売合計", ft.Icons.SHOPPING_BAG_OUTLINED, ft.Colors.TEAL_700),
                metric_card("粗利試算", _format_currency(summary["estimated_profit"]), "原価登録済み商品ベース", ft.Icons.TRENDING_UP, ft.Colors.ORANGE_800),
                metric_card("商品数", f"{_format_number(summary['product_count'])}SKU", "期間中に動いた商品数", ft.Icons.INVENTORY_2, ft.Colors.DEEP_PURPLE_700),
                metric_card("店舗数", f"{_format_number(summary['store_count'])}店舗", "売上があった店舗数", ft.Icons.STOREFRONT, ft.Colors.BLUE_GREY_700),
            ],
            spacing=12,
            run_spacing=10,
        )

        donut_src = build_donut_chart_src(category_rows[:5], "total_amount")
        category_chart = (
            ft.Row(
                [
                    ft.Container(
                        width=220,
                        alignment=ft.Alignment(0, 0),
                        content=ft.Image(src=donut_src, width=180, height=180, fit=ft.BoxFit.CONTAIN),
                    ),
                    ft.Container(expand=True, content=build_legend(category_rows[:5], "category", "total_amount")),
                ],
                spacing=14,
                wrap=True,
                run_spacing=12,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            )
            if donut_src
            else build_placeholder("カテゴリ構成を計算できる売上がありません。")
        )

        chart_panels = ft.ResponsiveRow(
            [
                ft.Container(
                    col={"xs": 12, "xl": 4},
                    content=section_card(
                        "カテゴリ構成",
                        "商品マスタCSVのカテゴリと商品名を使って売上を集計しています。",
                        category_chart,
                    ),
                ),
                ft.Container(
                    col={"xs": 12, "xl": 4},
                    content=section_card(
                        "店舗別売上",
                        "どの店舗で売上が動いているかを棒グラフで確認できます。",
                        build_bar_chart(
                            store_rows,
                            label_key="store_name",
                            value_key="total_amount",
                            value_formatter=_format_currency,
                            empty_message="店舗別売上はまだありません。",
                        ),
                    ),
                ),
                ft.Container(
                    col={"xs": 12, "xl": 4},
                    content=section_card(
                        "日別売上推移",
                        "選択期間の直近12日分を金額ベースで確認できます。",
                        build_bar_chart(
                            daily_rows,
                            label_key="transaction_date",
                            value_key="total_amount",
                            value_formatter=_format_currency,
                            empty_message="日別推移を表示できるデータがありません。",
                        ),
                    ),
                ),
            ],
            spacing=12,
            run_spacing=12,
        )

        detail_panels = ft.ResponsiveRow(
            [
                ft.Container(
                    col={"xs": 12, "xl": 4},
                    content=section_card(
                        "ABC分析",
                        "売上構成比でA・B・Cに分け、注力商品を把握します。",
                        build_ranked_rows(
                            abc_rows,
                            label_key="product_name",
                            amount_key="total_amount",
                            right_secondary_key="total_quantity",
                            right_secondary_label="販売数",
                            empty_message="ABC分析できる売上がありません。",
                            badge_key="abc_band",
                        ),
                    ),
                ),
                ft.Container(
                    col={"xs": 12, "xl": 4},
                    content=section_card(
                        "売れ筋商品",
                        "販売金額の高い商品を上から確認できます。",
                        build_ranked_rows(
                            product_rows,
                            label_key="product_name",
                            amount_key="total_amount",
                            right_secondary_key="total_quantity",
                            right_secondary_label="販売数",
                            empty_message="売れ筋商品はまだありません。",
                        ),
                    ),
                ),
                ft.Container(
                    col={"xs": 12, "xl": 4},
                    content=section_card(
                        "マスタ未紐付け",
                        "CSVの商品名と一致しなかった売上を一覧にして、分類漏れを見つけやすくします。",
                        build_ranked_rows(
                            unmatched_rows,
                            label_key="product_name",
                            amount_key="total_amount",
                            right_secondary_key="total_quantity",
                            right_secondary_label="販売数",
                            empty_message="未紐付け商品はありません。",
                        ),
                    ),
                ),
            ],
            spacing=12,
            run_spacing=12,
        )

        main_container.controls = [
            hero,
            filter_panel,
            metrics,
            *message_controls,
            chart_panels,
            detail_panels,
        ]
        page.update()

    def load_data():
        token = getattr(page, "access_token", None)
        state.loading = True
        state.error_messages = []
        state.last_sync_label = datetime.now().strftime("%Y/%m/%d %H:%M")

        raw_sales: list[dict] = []
        master_rows: list[dict] = []

        try:
            raw_sales = get_product_sales_data(token, limit=10000)
        except Exception as ex:
            state.error_messages.append(f"売上データの取得に失敗しました: {ex}")

        try:
            master_rows = inventory_db.get_all_products(limit=5000, offset=0)
        except Exception as ex:
            state.error_messages.append(f"商品マスタの取得に失敗しました: {ex}")

        state.all_rows = enrich_sales_records(raw_sales, master_rows)
        state.available_stores = [ALL_STORES] + sorted(
            {
                str(row.get("store_name", "")).strip()
                for row in state.all_rows
                if str(row.get("store_name", "")).strip()
            }
        )
        store_dropdown.options = [ft.dropdown.Option(store_name) for store_name in state.available_stores]
        if (store_dropdown.value or ALL_STORES) not in state.available_stores:
            store_dropdown.value = ALL_STORES

        valid_dates = [row["transaction_date_value"] for row in state.all_rows if row.get("transaction_date_value")]
        if valid_dates:
            state.min_date = min(valid_dates)
            state.max_date = max(valid_dates)
            if state.date_from is None or state.date_to is None:
                state.date_to = state.max_date
                state.date_from = max(state.min_date, state.max_date - timedelta(days=29))
            state.latest_sales_label = state.max_date.strftime("%Y/%m/%d")
        else:
            today = date.today()
            state.min_date = today
            state.max_date = today
            state.date_from = today
            state.date_to = today
            state.latest_sales_label = "-"

        state.filtered_rows = filter_sales_records(
            state.all_rows,
            date_from=state.date_from,
            date_to=state.date_to,
            search_query=search_field.value or "",
            store_name=store_dropdown.value or ALL_STORES,
        )
        state.loading = False
        render_body()

    def refresh_page(e=None):
        render_loading("売上データを更新しています...")
        page.run_thread(load_data)

    render_loading("売上データを読み込んでいます...")
    page.run_thread(load_data)

    return ft.View(
        route="/sales",
        appbar=ft.AppBar(
            leading=ft.Icon(ft.Icons.PAID),
            leading_width=40,
            title=ft.Text("売上管理", size=20, weight=ft.FontWeight.BOLD),
            actions=[
                ft.IconButton(icon=ft.Icons.REFRESH, tooltip="更新", on_click=refresh_page),
                ft.IconButton(icon=ft.Icons.LOGOUT, tooltip="ログアウト", on_click=logout),
            ],
        ),
        controls=[
            ft.Container(
                content=main_container,
                padding=18,
                expand=True,
            )
        ],
        navigation_bar=get_navigation_bar(page, selected_index=1),
    )
