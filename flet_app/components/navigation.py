import flet as ft
import inspect

def get_navigation_bar(page: ft.Page, selected_index: int = 0, before_navigate=None) -> ft.NavigationBar:
    async def on_change(e):
        target_route = None
        if e.control.selected_index == 0:
            target_route = "/dashboard"
        elif e.control.selected_index == 1:
            target_route = "/inventory"
        elif e.control.selected_index == 2:
            target_route = "/shift"
        elif e.control.selected_index == 3:
            target_route = "/customer-orders"

        if not target_route:
            return

        if before_navigate is not None:
            allowed = before_navigate(target_route)
            if inspect.isawaitable(allowed):
                allowed = await allowed
            if not allowed:
                e.control.selected_index = selected_index
                page.update()
                return

        await page.push_route(target_route)

    return ft.NavigationBar(
        selected_index=selected_index,
        on_change=on_change,
        destinations=[
            ft.NavigationBarDestination(
                icon=ft.Icons.DASHBOARD_OUTLINED,
                selected_icon=ft.Icons.DASHBOARD,
                label="ダッシュボード",
            ),
            ft.NavigationBarDestination(
                icon=ft.Icons.INVENTORY_2_OUTLINED,
                selected_icon=ft.Icons.INVENTORY_2,
                label="商品管理",
            ),
            ft.NavigationBarDestination(
                icon=ft.Icons.CALENDAR_MONTH_OUTLINED,
                selected_icon=ft.Icons.CALENDAR_MONTH,
                label="シフト管理",
            ),
            ft.NavigationBarDestination(
                icon=ft.Icons.ASSIGNMENT_OUTLINED,
                selected_icon=ft.Icons.ASSIGNMENT,
                label="客注管理",
            ),
        ],
    )
