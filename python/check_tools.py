#!/usr/bin/env python3
"""Check all GSM tool dependencies and report status."""
import sys
import subprocess
import shutil

def check(name, cmd):
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=5)
        print(f"  [OK] {name}")
        return True
    except Exception as e:
        print(f"  [NO] {name}: {e}")
        return False

def check_import(name, module):
    try:
        __import__(module)
        print(f"  [OK] {name}")
        return True
    except ImportError as e:
        print(f"  [NO] {name}: pip install {module}")
        return False

print("=== OptiGSM Tool Check ===\n")
print("[ADB Tools]")
check("adb", ["adb", "version"])
check("fastboot", ["fastboot", "--version"])

print("\n[Python libs]")
check_import("mtkclient", "mtkclient")
check_import("edlclient", "edl")
check_import("pyserial", "serial")
check_import("pyusb", "usb")

print("\n[System tools]")
check("heimdall", ["heimdall", "version"])
check("python3", [sys.executable, "--version"])

print("\n=== Install missing tools ===")
print("pip install mtkclient edlclient pyserial pyusb")
print("Heimdall: https://heimdall.wiki.kernel.org (Windows: scoop install heimdall)")
print("ADB: https://developer.android.com/studio/releases/platform-tools")
