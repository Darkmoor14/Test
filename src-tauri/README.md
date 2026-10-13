# Insta Grup Admin — desktop app

A Tauri wrapper around `admin-3.html` (the in-development admin panel), with
one feature the web version doesn't have: over-the-air updates.

- **App open/visible** → when a new version is found, a popup asks before
  installing (installing requires a relaunch).
- **App closed** → closing the window only hides it; the app keeps running
  in the background via the tray icon. With nobody looking at it, a found
  update installs and relaunches silently — next time the window is shown,
  it's already current.
- Quitting for real is done from the tray icon's "Ieșire" item.

`src-tauri/sync-frontend.sh` copies the files `admin-3.html` actually needs
(itself, `assets/`, `icons/`, `logo.png`, `docs/ghid-utilizare-lps.pdf`) into
`src-tauri/frontend/` before every dev run or build, so the app always
ships whatever's currently in the repo root without duplicating it by hand.

## One-time setup

1. **Generate the update-signing keypair** (signs release artifacts so the
   updater can trust them — unrelated to OS code-signing):
   ```sh
   cargo install tauri-cli --version "^2.0" --locked   # if not already installed
   cd src-tauri
   cargo tauri signer generate -w ~/.tauri/insta-grup-admin.key
   ```
   This prints a public key and writes the private key + password to the
   path given. **Never commit the private key.**

2. **Paste the public key** into `src-tauri/tauri.conf.json`'s
   `plugins.updater.pubkey`, replacing `REPLACE_WITH_GENERATED_PUBLIC_KEY`.

3. **Add two repo secrets** (Settings → Secrets and variables → Actions) so
   the release workflow can sign builds:
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you set in step 1

4. **Generate app icons** from the existing square logo:
   ```sh
   cd src-tauri
   cargo tauri icon ../icons/icon-512.png
   ```
   This fills in `icons/32x32.png`, `128x128.png`, `128x128@2x.png`,
   `icon.icns` (macOS) and `icon.ico` (Windows) that `tauri.conf.json`'s
   `bundle.icon` list expects.

## Releasing a new version

Bump `version` in both `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`,
commit, then tag and push:
```sh
git tag v0.1.1
git push origin v0.1.1
```
`.github/workflows/release-desktop.yml` builds signed Windows + macOS
installers, publishes a **draft** GitHub Release with them attached, and
generates `latest.json` (what every installed app's updater polls, per
`tauri.conf.json`'s `plugins.updater.endpoints`). Review the draft, then
publish it — installed apps pick up the update on their next background
check (every 2 hours, and on launch).

## macOS note

Without an Apple Developer certificate configured in the workflow, the
macOS build is unsigned/unnotarized: Gatekeeper will block first launch
until the user right-clicks the app → Open. Signing + notarization can be
added later (needs an Apple Developer account) — ask if you want that
wired up.

## Local dev

```sh
cd src-tauri
cargo tauri dev
```
