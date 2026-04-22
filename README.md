# Betwixt and Between

A visual worldbuilding OS for fiction writers. Manage characters, locations, events, acts, scenes, and notes in a floating-window desktop interface — where every entity is hyperlinked to every other.

Click a character in the Story Graph and their wiki page opens. Click a location in the Timeline and the World Map zooms to it. There are no dead ends.

**Who it's for:** Writers whose mental model is relational, not linear — fantasy and sci-fi worldbuilders, tabletop RPG designers, anyone who finds Scrivener's outlines hostile to how they actually think.

## Features

| Feature | What it does |
|---|---|
| **Story Graph** | Visual relationship map — characters, locations, events as nodes with typed edges (`allied_with`, `rivals`, `appears_in`, `caused_by`, etc.). |
| **Wiki** | Markdown notes for any entity. Full preview, inline search, linked entity chips. |
| **Timeline** | Acts, scenes, and events on a scrollable timeline. Expand rows to see nested detail. |
| **World Map** | Location cards with linked character and event chips. |
| **Window manager** | Every entity opens in its own floating window. Multiple windows of the same type stay open simultaneously. Taskbar groups them. |

## Running locally

**Prerequisites:** Node.js 18+, npm

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).
