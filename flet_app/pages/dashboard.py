import flet as ft
from flet_app.core.supabase_client import supabase
from flet_app.core.data_service import get_product_sales_data
from flet_app.components.navigation import get_navigation_bar
import pandas as pd

def DashboardView(page: ft.Page):
    
    async def logout(e):
        # Call supabase signout
        token = getattr(page, "access_token", None)
        if token:
            try:
                supabase.sign_out(token)
            except Exception:
                pass
        setattr(page, "is_authenticated", False)
        setattr(page, "access_token", None)
        await page.push_route("/login")

    # Simple Top Navbar
    appbar = ft.AppBar(
        leading=ft.Icon(ft.Icons.DASHBOARD),
        leading_width=40,
        title=ft.Text("POS Dashboard"),
        center_title=False,
        bgcolor=ft.Colors.SURFACE_CONTAINER_HIGHEST,
        actions=[
            ft.IconButton(ft.Icons.LOGOUT, on_click=logout, tooltip="Logout"),
        ],
    )

    main_container = ft.Column(
        controls=[
            ft.Row(
                [ft.ProgressRing(), ft.Text("Loading data...")],
                alignment=ft.MainAxisAlignment.CENTER
            )
        ],
        expand=True,
        scroll=ft.ScrollMode.AUTO,
    )

    def load_data():
        token = getattr(page, "access_token", None)
        try:
            # Fetch data from Supabase
            raw_data = get_product_sales_data(token, limit=5000)
            
            if not raw_data:
                main_container.controls = [ft.Text("No sales data found.", size=20)]
                page.update()
                return

            # Convert to Pandas DataFrame for easy aggregation
            df = pd.DataFrame(raw_data)
            
            # Aggregate total sales
            total_sales = df['total_amount'].sum()
            
            # Aggregate by store
            store_sales = df.groupby('store_name')['total_amount'].sum().reset_index()
            
            # Aggregate by product (Top 10)
            product_sales = df.groupby('product_name')['total_amount'].sum().reset_index().sort_values(by='total_amount', ascending=False).head(10)

            # Build UI Components
            summary_card = ft.Card(
                content=ft.Container(
                    padding=20,
                    content=ft.Column([
                        ft.Text("Total Sales", size=16, color=ft.Colors.GREY_700),
                        ft.Text(f"¥{int(total_sales):,}", size=36, weight=ft.FontWeight.BOLD, color=ft.Colors.BLUE),
                    ])
                )
            )
            
            # Store Sales Chart (Custom Container-based Bar Chart)
            # Create a horizontal bar chart using Flet standard components to ensure compatibility
            max_sales = store_sales['total_amount'].max() if not store_sales.empty else 1
            chart_rows = []
            for row in store_sales.itertuples():
                bar_width = (row.total_amount / max_sales) * 300 if max_sales > 0 else 0
                chart_rows.append(
                    ft.Row(
                        controls=[
                            ft.Container(ft.Text(row.store_name, max_lines=1, overflow=ft.TextOverflow.ELLIPSIS), width=120),
                            ft.Container(
                                bgcolor=ft.Colors.BLUE, 
                                width=max(bar_width, 5), 
                                height=24, 
                                border_radius=4,
                                tooltip=f"¥{int(row.total_amount):,}"
                            ),
                            ft.Text(f"¥{int(row.total_amount):,}", size=14, color=ft.Colors.GREY_700)
                        ],
                        alignment=ft.MainAxisAlignment.START,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER
                    )
                )
                
            store_chart = ft.Column(
                controls=chart_rows,
                scroll=ft.ScrollMode.AUTO,
                spacing=10
            )

            store_chart_card = ft.Card(
                content=ft.Container(
                    padding=20,
                    content=ft.Column([
                        ft.Text("Sales by Store", size=20, weight=ft.FontWeight.BOLD),
                        ft.Container(content=store_chart, height=300)
                    ]),
                ),
                expand=True,
            )

            # Top Products Data Table
            columns = [
                ft.DataColumn(ft.Text("Product Name")),
                ft.DataColumn(ft.Text("Sales Amount"), numeric=True)
            ]
            rows = []
            for row in product_sales.itertuples():
                rows.append(
                    ft.DataRow(
                        cells=[
                            ft.DataCell(ft.Text(str(row.product_name))),
                            ft.DataCell(ft.Text(f"¥{int(row.total_amount):,}")),
                        ]
                    )
                )

            top_products_table = ft.DataTable(
                columns=columns,
                rows=rows,
                border=ft.border.all(1, ft.Colors.GREY_200),
            )

            products_card = ft.Card(
                content=ft.Container(
                    padding=20,
                    content=ft.Column([
                        ft.Text("Top 10 Products", size=20, weight=ft.FontWeight.BOLD),
                        top_products_table
                    ], scroll=ft.ScrollMode.AUTO)
                ),
                expand=True,
            )

            # Update UI main container
            main_container.controls = [
                ft.Row([summary_card]),
                ft.Row([store_chart_card]),
                ft.Row([products_card]),
            ]
            
        except Exception as e:
            main_container.controls = [ft.Text(f"Error loading data: {str(e)}", color=ft.Colors.ERROR)]
        
        page.update()

    # Trigger data fetch in a background thread to keep UI responsive
    page.run_thread(load_data)

    content = ft.Container(
        content=main_container,
        padding=20,
        expand=True
    )

    return ft.View(
        route="/dashboard",
        appbar=appbar,
        controls=[
            content
        ],
        navigation_bar=get_navigation_bar(page, selected_index=0)
    )
