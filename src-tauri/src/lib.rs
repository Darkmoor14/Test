// Desktop wrapper around admin-3.html, with one feature beyond "show the
// page in a window": over-the-air updates that behave differently
// depending on whether anyone is actually looking at the app --
//
//   - Window open/visible  -> a new version is found, we ask before
//     installing (installing requires a relaunch, which would otherwise
//     yank the app out from under someone mid-task).
//   - Window hidden (closed to the tray, nobody watching) -> install and
//     relaunch straight away. Nothing to disrupt.
//
// The "closed" half only works because the window's close button hides
// the window rather than quitting the process (see the CloseRequested
// handler below) -- a fully-quit app can't check for anything. The tray
// icon's "Ieșire" item is the only real quit path.

use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(2 * 60 * 60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Deschide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Ieșire", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("Insta Grup Admin")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    check_for_update(handle.clone()).await;
                    tokio::time::sleep(UPDATE_CHECK_INTERVAL).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

async fn check_for_update(app: tauri::AppHandle) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return,
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        _ => return,
    };

    let is_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if !is_visible {
        // Nobody's watching -- install and relaunch quietly.
        if install_update(update).await {
            tauri::process::restart(&app.env());
        }
        return;
    }

    // App is in active use -- ask first, since installing means relaunching.
    let version = update.version.clone();
    let app_for_restart = app.clone();
    app.dialog()
        .message(format!(
            "O versiune nouă ({version}) este disponibilă. Aplicația se va reporni pentru a o instala."
        ))
        .title("Actualizare disponibilă")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Actualizează acum".into(),
            "Mai târziu".into(),
        ))
        .kind(MessageDialogKind::Info)
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            tauri::async_runtime::spawn(async move {
                if install_update(update).await {
                    tauri::process::restart(&app_for_restart.env());
                }
            });
        });
}

async fn install_update(update: tauri_plugin_updater::Update) -> bool {
    update.download_and_install(|_, _| {}, || {}).await.is_ok()
}
