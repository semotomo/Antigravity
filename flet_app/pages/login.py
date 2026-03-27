import flet as ft
from flet_app.core.auth_session import apply_auth_session, persist_auth_session
from flet_app.core.supabase_client import supabase

def LoginView(page: ft.Page):
    # Form fields
    email_field = ft.TextField(label="Email", width=300, keyboard_type=ft.KeyboardType.EMAIL)
    password_field = ft.TextField(label="Password", width=300, password=True, can_reveal_password=True)
    error_text = ft.Text(color=ft.Colors.ERROR, visible=False)

    async def login_click(e):
        error_text.visible = False
        page.update()
        
        email = email_field.value
        password = password_field.value
        
        if not email or not password:
            error_text.value = "Please enter both email and password."
            error_text.visible = True
            page.update()
            return
            
        try:
            # Attempt to login via Supabase
            res = supabase.sign_in_with_password(email, password)
            if "access_token" in res:
                auth_payload = {
                    "access_token": res.get("access_token"),
                    "refresh_token": res.get("refresh_token"),
                    "user_email": res.get("user", {}).get("email", email),
                }
                apply_auth_session(page, auth_payload)
                await persist_auth_session(auth_payload)
                await page.push_route("/dashboard")
        except Exception as ex:
            # Handle login error
            error_text.value = f"Login failed: {str(ex)}"
            error_text.visible = True
            page.update()

    login_button = ft.ElevatedButton("Login", on_click=login_click, width=300)

    # Simple modern layout
    content = ft.Container(
        content=ft.Column(
            [
                ft.Icon(ft.Icons.ACCOUNT_CIRCLE, size=80, color=ft.Colors.BLUE),
                ft.Text("Welcome Back", size=30, weight=ft.FontWeight.BOLD),
                ft.Text("Please sign in to access the dashboard", size=14, color=ft.Colors.GREY_700),
                ft.Container(height=20),
                email_field,
                password_field,
                error_text,
                ft.Container(height=10),
                login_button,
            ],
            horizontal_alignment=ft.CrossAxisAlignment.CENTER,
            alignment=ft.MainAxisAlignment.CENTER,
            spacing=10,
        ),
        padding=40,
        border_radius=10,
        bgcolor=ft.Colors.SURFACE_CONTAINER_HIGHEST,
        alignment=ft.Alignment(0, 0),
        width=400,
        margin=20,
        shadow=ft.BoxShadow(
            spread_radius=1,
            blur_radius=15,
            color=ft.Colors.BLUE_GREY_100,
        )
    )

    return ft.View(
        route="/login",
        controls=[
            ft.Row([content], alignment=ft.MainAxisAlignment.CENTER)
        ],
        vertical_alignment=ft.MainAxisAlignment.CENTER,
        horizontal_alignment=ft.CrossAxisAlignment.CENTER,
    )
