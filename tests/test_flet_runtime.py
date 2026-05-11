import os
import unittest
from unittest.mock import patch

import flet as ft

from flet_app.main import get_runtime_options, run_app


class FletRuntimeTests(unittest.TestCase):
    def test_get_runtime_options_uses_render_port_and_browser_view(self):
        with patch.dict(os.environ, {"PORT": "10000"}, clear=False):
            options = get_runtime_options()

        self.assertEqual(options["port"], 10000)
        self.assertEqual(options["host"], "0.0.0.0")
        self.assertEqual(options["view"], ft.AppView.WEB_BROWSER)

    def test_get_runtime_options_falls_back_to_local_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            options = get_runtime_options()

        self.assertEqual(options["port"], 8080)
        self.assertIsNone(options["host"])
        self.assertEqual(options["view"], ft.AppView.FLET_APP)

    def test_get_runtime_options_handles_invalid_port(self):
        with patch.dict(os.environ, {"PORT": "abc"}, clear=False):
            options = get_runtime_options()

        self.assertEqual(options["port"], 8080)
        self.assertEqual(options["view"], ft.AppView.WEB_BROWSER)

    @patch("flet_app.main.ft.app")
    def test_run_app_passes_runtime_options_to_flet(self, mock_app):
        with patch.dict(os.environ, {"PORT": "12000"}, clear=False):
            run_app()

        mock_app.assert_called_once()
        _, kwargs = mock_app.call_args
        self.assertEqual(kwargs["port"], 12000)
        self.assertEqual(kwargs["host"], "0.0.0.0")
        self.assertEqual(kwargs["view"], ft.AppView.WEB_BROWSER)
        self.assertIn("target", kwargs)


if __name__ == "__main__":
    unittest.main()
