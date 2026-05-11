import os

import flet as ft
from flet_app.core.auth_session import restore_auth_session
from flet_app.pages.login import LoginView
from flet_app.pages.dashboard import DashboardView
from flet_app.pages.sales import SalesView
from flet_app.pages.shift import ShiftView
from flet_app.pages.inventory import InventoryView
from flet_app.pages.customer_orders import CustomerOrdersView

DEFAULT_WEB_PORT = 8080


async def main(page: ft.Page):
    page.title = "POS Dashboard & Store Management System"
    page.theme_mode = ft.ThemeMode.LIGHT
    page.padding = 0
    page.spacing = 0
    await restore_auth_session(page)

    async def route_change(e: ft.RouteChangeEvent):
        page.views.clear()

        # 認証済みかどうかを確認する
        is_auth = getattr(page, "is_authenticated", False)

        if is_auth and page.route == "/login":
            await page.push_route("/dashboard")
            return

        # 未認証で保護画面へ来た場合はログインへ戻す
        if not is_auth and page.route != "/login":
            await page.push_route("/login")
            return

        # ルートに応じて表示画面を差し替える
        if page.route == "/login":
            page.views.append(LoginView(page))
        elif page.route == "/dashboard":
            page.views.append(DashboardView(page))
        elif page.route == "/sales":
            page.views.append(SalesView(page))
        elif page.route == "/shift":
            page.views.append(ShiftView(page))
        elif page.route == "/inventory":
            page.views.append(InventoryView(page))
        elif page.route == "/customer-orders":
            page.views.append(CustomerOrdersView(page))
        else:
            # 想定外ルートは認証状態に応じて既定画面へ戻す
            if is_auth:
                await page.push_route("/dashboard")
            else:
                await page.push_route("/login")

        page.update()

    async def view_pop(e: ft.ViewPopEvent):
        page.views.pop()
        top_view = page.views[-1]
        await page.push_route(top_view.route)

    page.on_route_change = route_change
    page.on_view_pop = view_pop

    # 初回表示ルートを決める
    if getattr(page, "route", "") == "/":
        await page.push_route("/dashboard" if getattr(page, "is_authenticated", False) else "/login")
    else:
        await page.push_route(getattr(page, "route", "/login"))


def get_runtime_options() -> dict:
    """Render とローカル実行の両方で使う起動オプションを返す。"""
    raw_port = os.environ.get("PORT", str(DEFAULT_WEB_PORT))
    try:
        port = int(raw_port)
    except (TypeError, ValueError):
        port = DEFAULT_WEB_PORT

    render_mode = bool(
        os.environ.get("PORT")
        or os.environ.get("RENDER")
        or os.environ.get("RENDER_EXTERNAL_URL")
    )
    return {
        "port": port,
        "host": "0.0.0.0" if render_mode else None,
        "view": ft.AppView.WEB_BROWSER if render_mode else ft.AppView.FLET_APP,
    }


def run_app():
    """Flet アプリを実行する。Render ではブラウザ表示用で起動する。"""
    runtime_options = get_runtime_options()
    ft.app(
        target=main,
        port=runtime_options["port"],
        host=runtime_options["host"],
        view=runtime_options["view"],
    )


if __name__ == "__main__":
    run_app()
