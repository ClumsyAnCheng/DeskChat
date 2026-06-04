# Commercial Roadmap

## Product Target
Deskchat should become a polished desktop AI workspace: reliable chat, clean knowledge management, strong rendering, and extensible tools such as mind maps.

## Architecture Direction
- Short term: keep Electron, add mature rendering and UI foundations without a build-system migration.
- Mid term: migrate renderer to TypeScript + React or Vue with a component library and state isolation.
- Long term: evaluate Tauri only if package size, memory, or native integration becomes a business blocker.

## Completed Baseline
- GitHub baseline commit created locally.
- Markdown rendering upgraded with GFM tables.
- LaTeX rendering added with KaTeX.
- Code block styling and highlighting added.
- UI palette and rich message layout moved toward a cleaner desktop-workspace style.

## Next Phases
1. Renderer architecture: componentize sidebar, chat thread, composer, knowledge panel, and settings.
2. Data layer: versioned local storage, import/export, backup, and migration checks.
3. Commercial UX: command menu, keyboard shortcuts, searchable history, empty states, onboarding, and error recovery.
4. Mind maps: add a tool panel and message artifact model before implementing the graph editor.
5. Packaging: signed installers, auto-update, crash logs, and release channels.
