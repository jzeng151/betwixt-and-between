# Save before signing out

Sign-out revokes a browser-wide session. Component-local busy flags cannot protect writes after a window closes, and notifying other tabs after revocation is too late to save their drafts.

Notes and Settings track outstanding mutations in a shared store. Failed writes block sign-out until the user acknowledges them in Account; non-idempotent requests are not automatically replayed. Notes drafts and rejected preference patches retain their existing retry behavior.

Each mounted workspace holds a shared Web Lock. Sign-out broadcasts a save request, blocks editing in each participating tab, and waits for an exclusive workspace lock. Tabs release their locks only after saving. A failed or unresponsive tab cancels sign-out and restores editing; an exclusive coordinator lock prevents simultaneous sign-out attempts. Successful revocation broadcasts navigation to login and replaces history entries.

Validation includes two authenticated Firefox tabs with pending edits, a rejected remote save followed by retry, a Settings mutation surviving window closure, session revocation, and protected navigation after logout.

The watchdog covers both saving and session revocation, and cancels the auth fetch on timeout. Once revocation has been dispatched, failures close every workspace and show an unconfirmed-sign-out notice at login; they never resume cached workspaces because the session may already be revoked. Preference reconciliation must finish before the save barrier is released. Browsers without the required coordination APIs can still open the workspace; sign-out explains how to reopen it in a supported secure context.

The coordinator records its phase before sending the revocation request. If that tab closes or crashes, surviving tabs read the phase before resuming; dispatched or confirmed revocation closes their workspaces instead. The record contains only an attempt ID and phase.
