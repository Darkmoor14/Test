// Modules and page markup are loaded before the authenticated dashboard starts.
//
// This registration used to live in tickets.js, right where it's used.
// But supabase-js emits its INITIAL_SESSION event asynchronously, via a
// microtask queued the moment the listener is registered — and the
// browser drains microtasks after each classic <script> tag finishes,
// before moving on to the next one. Since tickets.js loads well before
// later feature files (projects.js, erp.js, ...), that early emission
// could fire showDashboard()/showLogin() before those files had
// declared their own module-level state (e.g. projectSelectedIds),
// throwing "X is not defined". Registering it here, in the very last
// script on the page, guarantees every feature file has already run.
supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showDashboard(session.user.email);
  } else {
    showLogin();
  }
});
checkSession();
