#!/usr/bin/env python3
"""
One-time OAuth2 authorization for invoice@levelupvn.com Gmail access.

Usage:
    python sync/stramark/gmail_auth_invoice.py

This opens a browser window. Sign in with invoice@levelupvn.com
and grant access. Token is saved for future automated use.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CREDENTIALS_FILE = ROOT / "config" / "manual_data" / "client_secret_178422801328-760qj2adakk48a96oft4usveb80hrvrd.apps.googleusercontent.com.json"
TOKEN_FILE = ROOT / "config" / "gmail_token_invoice.json"

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]


def main():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds and creds.valid:
        print("Token already valid. No action needed.")
        return

    if creds and creds.expired and creds.refresh_token:
        print("Refreshing expired token...")
        creds.refresh(Request())
    else:
        print(f"Opening browser for OAuth login...")
        print(f">>> Sign in with: invoice@levelupvn.com <<<")
        print()
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
        creds = flow.run_local_server(port=8099)

    with open(TOKEN_FILE, "w") as f:
        f.write(creds.to_json())

    print(f"\nToken saved to: {TOKEN_FILE}")
    print("Gmail access authorized successfully.")

    # Quick test
    from googleapiclient.discovery import build
    service = build("gmail", "v1", credentials=creds)
    profile = service.users().getProfile(userId="me").execute()
    print(f"Authenticated as: {profile.get('emailAddress')}")


if __name__ == "__main__":
    main()
