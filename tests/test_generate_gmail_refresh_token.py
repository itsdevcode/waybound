"""
Unit tests for scripts/generate_gmail_refresh_token.py

Tests client secrets validation, token masking, CLI arguments, and error handling
without making external Google API calls or launching actual local servers.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.generate_gmail_refresh_token import (
    GMAIL_SEND_SCOPE,
    main,
    mask_token,
    parse_args,
    run_oauth_flow,
    validate_client_secrets_file,
)


@pytest.fixture
def valid_desktop_client_file(tmp_path: Path) -> Path:
    secrets_data = {
        "installed": {
            "client_id": "test_client_id_123456789.apps.googleusercontent.com",
            "project_id": "waybound-test",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": "GOCSPX-test_client_secret_abcdef123456",
            "redirect_uris": ["http://localhost"],
        }
    }
    p = tmp_path / "client_secret.json"
    p.write_text(json.dumps(secrets_data), encoding="utf-8")
    return p


class TestTokenMasking:
    def test_empty_token(self) -> None:
        assert mask_token("") == "<none>"

    def test_short_token(self) -> None:
        assert mask_token("abc") == "***"

    def test_standard_token(self) -> None:
        masked = mask_token("1//04abcdefghijklmnop1234", 4, 4)
        assert masked.startswith("1//0...")
        assert masked.endswith("1234 (len: 25)")
        # Never reveals full inner secret
        assert "abcdefghijklmnop" not in masked


class TestClientSecretsValidation:
    def test_file_not_found(self, tmp_path: Path) -> None:
        missing = tmp_path / "nonexistent.json"
        with pytest.raises(FileNotFoundError, match="not found"):
            validate_client_secrets_file(missing)

    def test_invalid_json(self, tmp_path: Path) -> None:
        broken = tmp_path / "broken.json"
        broken.write_text("not json content", encoding="utf-8")
        with pytest.raises(ValueError, match="Failed to parse"):
            validate_client_secrets_file(broken)

    def test_missing_client_config_key(self, tmp_path: Path) -> None:
        invalid_structure = tmp_path / "invalid.json"
        invalid_structure.write_text(json.dumps({"some_other_key": {}}), encoding="utf-8")
        with pytest.raises(ValueError, match="Expected root key 'installed'"):
            validate_client_secrets_file(invalid_structure)

    def test_missing_client_id_or_secret(self, tmp_path: Path) -> None:
        incomplete = tmp_path / "incomplete.json"
        incomplete.write_text(
            json.dumps({"installed": {"client_id": "my_id"}}), encoding="utf-8"
        )
        with pytest.raises(ValueError, match="missing 'client_id' or 'client_secret'"):
            validate_client_secrets_file(incomplete)

    def test_valid_desktop_file_returns_data(self, valid_desktop_client_file: Path) -> None:
        data = validate_client_secrets_file(valid_desktop_client_file)
        assert "installed" in data
        assert data["installed"]["client_id"].startswith("test_client_id")


class TestParseArgs:
    def test_requires_credentials_file(self) -> None:
        with pytest.raises(SystemExit):
            parse_args([])

    def test_parses_defaults(self, valid_desktop_client_file: Path) -> None:
        args = parse_args(["-c", str(valid_desktop_client_file)])
        assert args.credentials_file == valid_desktop_client_file
        assert args.port == 0
        assert args.no_browser is False
        assert args.show_refresh_token is False

    def test_parses_flags(self, valid_desktop_client_file: Path) -> None:
        args = parse_args(
            [
                "-c",
                str(valid_desktop_client_file),
                "--port",
                "8085",
                "--no-browser",
                "--show-refresh-token",
            ]
        )
        assert args.port == 8085
        assert args.no_browser is True
        assert args.show_refresh_token is True


class TestOAuthFlowExecution:
    @patch("scripts.generate_gmail_refresh_token.InstalledAppFlow")
    def test_run_oauth_flow_success(
        self, mock_flow_cls: MagicMock, valid_desktop_client_file: Path
    ) -> None:
        mock_flow = MagicMock()
        mock_flow_cls.from_client_secrets_file.return_value = mock_flow

        mock_creds = MagicMock()
        mock_creds.client_id = "test_client_id"
        mock_creds.client_secret = "test_client_secret"
        mock_creds.refresh_token = "1//mock_refresh_token_xyz"
        mock_creds.scopes = [GMAIL_SEND_SCOPE]
        mock_flow.run_local_server.return_value = mock_creds

        res = run_oauth_flow(valid_desktop_client_file, port=8085, open_browser=False)

        mock_flow_cls.from_client_secrets_file.assert_called_once_with(
            str(valid_desktop_client_file),
            scopes=[GMAIL_SEND_SCOPE],
        )
        mock_flow.run_local_server.assert_called_once_with(
            port=8085,
            prompt="consent",
            access_type="offline",
            open_browser=False,
        )
        assert res["refresh_token"] == "1//mock_refresh_token_xyz"
        assert res["scopes"] == [GMAIL_SEND_SCOPE]

    @patch("scripts.generate_gmail_refresh_token.run_oauth_flow")
    def test_main_masked_output_by_default(
        self,
        mock_run_flow: MagicMock,
        valid_desktop_client_file: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        mock_run_flow.return_value = {
            "client_id": "test_cid_123",
            "client_secret": "test_sec_456",
            "refresh_token": "1//full_secret_refresh_token_test_12345",
            "scopes": [GMAIL_SEND_SCOPE],
        }

        exit_code = main(["-c", str(valid_desktop_client_file)])
        assert exit_code == 0
        captured = capsys.readouterr().out
        assert "Authorization Successful!" in captured
        # The full secret token must NOT appear without --show-refresh-token
        assert "1//full_secret_refresh_token_test_12345" not in captured
        assert "1//ful..._12345" in captured

    @patch("scripts.generate_gmail_refresh_token.run_oauth_flow")
    def test_main_unmasked_when_requested(
        self,
        mock_run_flow: MagicMock,
        valid_desktop_client_file: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        mock_run_flow.return_value = {
            "client_id": "test_cid_123",
            "client_secret": "test_sec_456",
            "refresh_token": "1//full_secret_refresh_token_test_12345",
            "scopes": [GMAIL_SEND_SCOPE],
        }

        exit_code = main(["-c", str(valid_desktop_client_file), "--show-refresh-token"])
        assert exit_code == 0
        captured = capsys.readouterr().out
        assert "GMAIL_REFRESH_TOKEN=1//full_secret_refresh_token_test_12345" in captured
        assert "SECURITY WARNING: Refresh token printed below" in captured

    @patch("scripts.generate_gmail_refresh_token.run_oauth_flow")
    def test_main_warns_when_refresh_token_missing(
        self,
        mock_run_flow: MagicMock,
        valid_desktop_client_file: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        mock_run_flow.return_value = {
            "client_id": "test_cid_123",
            "client_secret": "test_sec_456",
            "refresh_token": None,
            "scopes": [GMAIL_SEND_SCOPE],
        }

        exit_code = main(["-c", str(valid_desktop_client_file)])
        assert exit_code == 1
        captured = capsys.readouterr().out
        assert "Google did NOT return a refresh token" in captured
        assert "Revoke WAYBOUND access" in captured
