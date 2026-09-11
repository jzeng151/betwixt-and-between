# Restore windows within a browser tab

Open windows belong to a tab, while appearance profiles belong to an account. Store window IDs, geometry, stacking, minimized/maximized state, and entity selections in sessionStorage with the authenticated user ID. Restoring checks that owner and validates known metadata, so another account cannot inherit the layout and independent tabs do not overwrite one another. Keep focused-graph window IDs to reconnect their existing server-side canvas positions.

Save on pagehide, hiding the tab, and leaving the app. This covers ordinary reloads without synchronous storage writes during every pointer move. It does not promise crash recovery, unsaved editor-draft recovery, or cross-device layout sync. Story content stays in its existing stores and APIs. Unavailable storage falls back to the normal fresh workspace.
