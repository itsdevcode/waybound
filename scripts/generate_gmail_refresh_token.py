#!/usr/bin/env python3
"""
scripts/generate_gmail_refresh_token.py

Secure, developer-only CLI utility to obtain a Google OAuth2 refresh token for the
Gmail API (https://www.googleapis.com/auth/gmail.send scope) using an authorized
Google Cloud Desktop OAuth Client.

SECURITY RULES:
- Never writes credentials, client secrets, or refresh tokens to disk or tracked project files.
- Never logs client secrets, authorization codes, or access tokens.
- Obtains refresh tokens via local loopback redirect with offline access (prompt='consent').
- By default, displays masked token information unless explicitly requested via --show-refresh-token.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# Developer-only dependency
try:
    from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore[import-untyped]
except ImportError:
    InstalledAppFlow = None  # Handled gracefully with setup instructions

GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"


def validate_client_secrets_file(file_path: Path) -> dict[str, Any]:
    """
    Validates that the provided client secrets JSON file exists, is valid JSON,
    and contains a desktop ('installed') or web client configuration.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"OAuth client secrets file not found: {file_path}")

    if not file_path.is_file():
        raise ValueError(f"Path is not a regular file: {file_path}")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse client secrets file as JSON: {exc}") from exc

    client_config = data.get("installed") or data.get("web")
    if not client_config:
        raise ValueError(
            "Invalid Google OAuth client secrets file. Expected root key 'installed' (Desktop Client) or 'web'."
        )

    client_id = client_config.get("client_id")
    client_secret = client_config.get("client_secret")

    if not client_id or not client_secret:
        raise ValueError("OAuth client secrets file is missing 'client_id' or 'client_secret'.")

    return data


def mask_token(token: str, visible_prefix: int = 4, visible_suffix: int = 4) -> str:
    """Masks a secret token string for safe terminal display."""
    if not token:
        return "<none>"
    if len(token) <= (visible_prefix + visible_suffix):
        return "***"
    return f"{token[:visible_prefix]}...{token[-visible_suffix:]} (len: {len(token)})"


def run_oauth_flow(
    client_secrets_path: Path,
    port: int = 0,
    open_browser: bool = True,
) -> dict[str, Any]:
    """
    Runs the Google OAuth local server flow to obtain an authorization code and exchange
    it for an offline refresh token.
    """
    if InstalledAppFlow is None:
        raise RuntimeError(
            "Missing developer dependency 'google-auth-oauthlib'.\n"
            "Install it in your local development virtual environment:\n\n"
            "    pip install google-auth-oauthlib\n"
        )

    _ = validate_client_secrets_file(client_secrets_path)

    flow = InstalledAppFlow.from_client_secrets_file(
        str(client_secrets_path),
        scopes=[GMAIL_SEND_SCOPE],
    )

    # run_local_server automatically sets access_type='offline' and prompt='consent'
    # when prompt is passed, ensuring a refresh_token is returned even if the user
    # previously authorized the application.
    creds = flow.run_local_server(
        port=port,
        prompt="consent",
        access_type="offline",
        open_browser=open_browser,
    )

    return {
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "refresh_token": creds.refresh_token,
        "scopes": list(creds.scopes or [GMAIL_SEND_SCOPE]),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a Gmail API OAuth2 refresh token for WAYBOUND transactional email delivery."
    )
    parser.add_argument(
        "--credentials-file",
        "-c",
        required=True,
        type=Path,
        help="Path to Google Cloud OAuth Desktop client JSON file (e.g. client_secret.json).",
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=0,
        help="Local port for the OAuth redirect callback (default: 0 for dynamic free port).",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not automatically launch system browser; display the authorization URL instead.",
    )
    parser.add_argument(
        "--show-refresh-token",
        action="store_true",
        help="Explicitly print the full unmasked refresh token to stdout. Use with caution in private terminals.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    print("=" * 70)
    print("WAYBOUND - Gmail API OAuth2 Refresh Token Generator")
    print("=" * 70)

    try:
        validated_data = validate_client_secrets_file(args.credentials_file)
        client_config = validated_data.get("installed") or validated_data.get("web") or {}
        client_id = client_config.get("client_id", "")
        print(f"[+] Loaded client secrets from: {args.credentials_file}")
        print(f"[+] OAuth Client ID: {mask_token(client_id, 8, 4)}")
        print(f"[+] Requested Scope: {GMAIL_SEND_SCOPE}")
    except Exception as exc:
        print(f"[-] Validation Error: {exc}", file=sys.stderr)
        return 1

    print("\nStarting local OAuth callback listener...")
    try:
        tokens = run_oauth_flow(
            client_secrets_path=args.credentials_file,
            port=args.port,
            open_browser=not args.no_browser,
        )
    except Exception as exc:
        print(f"[-] Authorization Flow Failed: {exc}", file=sys.stderr)
        return 1

    refresh_token = tokens.get("refresh_token")

    if not refresh_token:
        print("\n" + "!" * 70)
        print("[-] WARNING: Google did NOT return a refresh token!")
        print("!" * 70)
        print(
            "Possible causes and troubleshooting steps:\n"
            "1. The OAuth consent was previously granted without prompt='consent'.\n"
            "2. Revoke WAYBOUND access at https://myaccount.google.com/permissions\n"
            "   and re-run this script to trigger a fresh offline consent grant.\n"
            "3. Ensure your Google Cloud OAuth Client is configured as a 'Desktop App'.\n"
        )
        return 1

    print("\n" + "=" * 70)
    print("[✓] Authorization Successful! Refresh token obtained.")
    print("=" * 70)

    if args.show_refresh_token:
        print("\n[!] SECURITY WARNING: Refresh token printed below. Do not share or log this value.")
        print(f"GMAIL_REFRESH_TOKEN={refresh_token}\n")
    else:
        print(f"\nGMAIL_REFRESH_TOKEN={mask_token(refresh_token, 6, 6)}")
        print("Tip: Re-run with '--show-refresh-token' to view the full value for your environment configuration.")

    print("\nConfiguration Instructions for Render / Local .env:")
    print("-" * 70)
    print("Set the following backend environment variables:")
    print("  EMAIL_PROVIDER=gmail_api")
    print("  EMAIL_FROM=\"WAYBOUND <your_authorized_email@gmail.com>\"")
    print(f"  GMAIL_CLIENT_ID={tokens['client_id']}")
    print(f"  GMAIL_CLIENT_SECRET={'<your_client_secret_from_' + args.credentials_file.name + '>'}")
    if args.show_refresh_token:
        print(f"  GMAIL_REFRESH_TOKEN={refresh_token}")
    else:
        print("  GMAIL_REFRESH_TOKEN=<unmasked_refresh_token_from_--show-refresh-token>")
    print("  GMAIL_SENDER_EMAIL=\"WAYBOUND <your_authorized_email@gmail.com>\"")
    print("-" * 70)
    print("Note: Do NOT commit client_secret.json or your refresh token to git repository.\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
