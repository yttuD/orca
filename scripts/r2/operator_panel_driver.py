#!/usr/bin/env python3
"""
Windows Operator Web UI Driver using Playwright.
Interacts directly with the authentic FastAPI web panel DOM at http://127.0.0.1:{port}/.
Unlocks the operator session, locates the pending device, captures screenshots, and clicks 'Aprobar'.
"""
import argparse
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description="Windows Operator Web UI Driver")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", type=str, required=True)
    parser.add_argument("--device-id", type=str, default="")
    parser.add_argument("--output-dir", type=str, required=True)
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 960})
        page = context.new_page()

        url = f"http://127.0.0.1:{args.port}/"
        page.goto(url, wait_until="networkidle")

        # 1. Unlock operator panel via real UI input and button click
        try:
            page.wait_for_selector("#unlock-token-input", timeout=5000)
            page.fill("#unlock-token-input", args.token)
            page.click("#btn-unlock-submit")
            page.wait_for_selector("#modal-unlock-operator", state="hidden", timeout=10000)
            time.sleep(1)
        except Exception:
            # Might already be unlocked if session exists
            pass

        # 2. Open mobile devices modal via button click
        page.wait_for_selector("#btn-mobile-devices", timeout=5000)
        page.click("#btn-mobile-devices")
        page.wait_for_selector("#modal-mobile-pairing.active", timeout=5000)

        # 3. Wait for pending device and "Aprobar" button inside mobile devices table
        approve_btn_selector = "#mobile-devices-tbody button:has-text('Aprobar')"
        found = False
        for _ in range(35):
            if page.locator(approve_btn_selector).count() > 0:
                found = True
                break
            page.evaluate("if (window.loadMobileDevices) window.loadMobileDevices();")
            time.sleep(1)
        if not found:
            page.wait_for_selector(approve_btn_selector, timeout=5000)

        # 4. Capture screenshot of Windows Operator UI with device in PENDING_APPROVAL
        pending_shot = out_dir / "windows-operator-01-pending.png"
        page.screenshot(path=str(pending_shot))
        print(f"  --> Windows Operator UI screenshot: {pending_shot.name}")

        # 5. Click the "Aprobar" button in the real Windows UI
        page.click(approve_btn_selector)
        time.sleep(2)

        # 6. Wait for table update to show Revocar button (authorized state)
        page.wait_for_selector("#mobile-devices-tbody button:has-text('Revocar')", timeout=15000)

        # 7. Capture screenshot of Windows Operator UI showing device AUTHORIZED
        approved_shot = out_dir / "windows-operator-02-approved.png"
        page.screenshot(path=str(approved_shot))
        print(f"  --> Windows Operator UI screenshot: {approved_shot.name}")

        browser.close()
        print(json.dumps({"ok": True, "event": "OPERATOR_UI_APPROVED"}))


if __name__ == "__main__":
    main()
