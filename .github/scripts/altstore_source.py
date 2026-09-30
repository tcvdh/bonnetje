#!/usr/bin/env python3
"""Builds altstore.json, an AltStore-compatible source, for the IPA that was just built.

Feather, AltStore, SideStore and similar importers read this file: add its URL as a source and the
app shows up with its version, size and download link.

The site (GitHub Pages) only ever holds the latest IPA, so the source lists exactly one version.
Older builds stay available as GitHub releases. Standard library only.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

TINT = "5CC8FF"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site-url", required=True, help="where the site is published, e.g. https://user.github.io/repo")
    ap.add_argument("--developer", required=True, help="name shown as developer")
    ap.add_argument("--ipa-name", default="BonnetjeSplitter.ipa")
    ap.add_argument("--size", type=int, required=True, help="IPA size in bytes")
    ap.add_argument("--build", required=True, help="build number (must increase every build)")
    ap.add_argument("--min-os", default="15.1")
    ap.add_argument("--notes", default="")
    ap.add_argument("--app-json", default="app.json")
    ap.add_argument("--out", default="altstore.json")
    a = ap.parse_args()

    site = a.site_url.rstrip("/")
    expo = json.loads(Path(a.app_json).read_text())["expo"]
    bundle_id = expo["ios"]["bundleIdentifier"]
    version = expo["version"]

    # Permission texts come from app.json, so the source shows what the app really asks for.
    picker = next((p[1] for p in expo.get("plugins", []) if isinstance(p, list) and p[0] == "expo-image-picker"), {})
    privacy = {
        "NSCameraUsageDescription": picker.get("cameraPermission", ""),
        "NSPhotoLibraryUsageDescription": picker.get("photosPermission", ""),
        "NSLocalNetworkUsageDescription": expo["ios"].get("infoPlist", {}).get("NSLocalNetworkUsageDescription", ""),
    }
    privacy = {k: v for k, v in privacy.items() if v}

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    description = a.notes or f"Versie {version}"
    download_url = f"{site}/{a.ipa_name}"

    source = {
        "name": "Bonnetje Splitter",
        "identifier": f"{bundle_id}.source",
        "subtitle": "Bonnetjes eerlijk verdelen",
        "description": "Bonnetjes van Albert Heijn en andere winkels verdelen met je huisgenoten.",
        "iconURL": f"{site}/icon.png",
        "website": site,
        "tintColor": TINT,
        "sourceURL": f"{site}/altstore.json",
        "apps": [
            {
                "name": "Bonnetje Splitter",
                "bundleIdentifier": bundle_id,
                "developerName": a.developer,
                "subtitle": "Bonnetjes eerlijk verdelen",
                "localizedDescription": (
                    "Haal je Albert Heijn-bonnetjes op of scan een bonnetje van elke andere winkel, "
                    "verdeel de producten over je huisgenoten en houd bij wie al betaald heeft."
                ),
                "iconURL": f"{site}/icon.png",
                "tintColor": TINT,
                "category": "utilities",
                "screenshotURLs": [],
                "versions": [
                    {
                        "version": version,
                        "buildVersion": str(a.build),
                        "date": now,
                        "localizedDescription": description,
                        "downloadURL": download_url,
                        "size": a.size,
                        "minOSVersion": a.min_os,
                    }
                ],
                "appPermissions": {"entitlements": [], "privacy": privacy},
                # Flat fields for importers that only know the older single-version format
                "version": version,
                "versionDate": now,
                "versionDescription": description,
                "downloadURL": download_url,
                "size": a.size,
            }
        ],
        "news": [],
    }

    Path(a.out).write_text(json.dumps(source, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {a.out}: {bundle_id} {version} (build {a.build}), source URL {site}/altstore.json")


if __name__ == "__main__":
    main()
