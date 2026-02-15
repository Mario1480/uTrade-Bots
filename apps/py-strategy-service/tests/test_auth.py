from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import HTTPException

import main


class AuthTests(unittest.TestCase):
    def test_authorized_when_expected_token_empty(self) -> None:
        self.assertTrue(main.is_token_authorized(None, ""))
        self.assertTrue(main.is_token_authorized("anything", ""))

    def test_missing_token_unauthorized_when_expected_set(self) -> None:
        self.assertFalse(main.is_token_authorized(None, "secret"))

    def test_wrong_token_unauthorized(self) -> None:
        self.assertFalse(main.is_token_authorized("wrong", "secret"))

    def test_correct_token_authorized(self) -> None:
        self.assertTrue(main.is_token_authorized("secret", "secret"))

    def test_require_auth_raises_401_for_wrong_token(self) -> None:
        original = main.AUTH_TOKEN
        try:
            main.AUTH_TOKEN = "secret"
            with self.assertRaises(HTTPException) as ctx:
                main.require_auth("wrong")
            self.assertEqual(ctx.exception.status_code, 401)
        finally:
            main.AUTH_TOKEN = original


if __name__ == "__main__":
    unittest.main()
