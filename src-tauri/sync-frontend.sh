#!/usr/bin/env bash
# Copies the bits of the repo root that admin-3.html actually needs into
# src-tauri/frontend/, which is what tauri.conf.json's build.frontendDist
# points at. Run automatically by `cargo tauri dev`/`build` (see
# beforeDevCommand/beforeBuildCommand) so the desktop app always ships
# whatever is currently in admin-3.html without duplicating it by hand or
# packaging the rest of the repo (other admin panels, Supabase migrations,
# the public site) into the installer.
set -euo pipefail
cd "$(dirname "$0")/.."

dest="src-tauri/frontend"
rm -rf "$dest"
mkdir -p "$dest"

cp admin-3.html "$dest/admin-3.html"
cp logo.png "$dest/logo.png"
cp -r assets "$dest/assets"
cp -r icons "$dest/icons"
mkdir -p "$dest/docs"
cp docs/ghid-utilizare-lps.pdf "$dest/docs/ghid-utilizare-lps.pdf"
