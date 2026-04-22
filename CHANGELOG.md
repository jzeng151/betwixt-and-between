# Changelog

All notable changes to this project will be documented in this file.

## [0.0.2] - 2026-04-22

### Added
- API test suite (`e2e/api.spec.ts`): 28 HTTP-level tests covering the full Entities, Relationships, and Canvas Positions APIs — CRUD, validation, error cases, ordering, and ghost-ID rejection
- Feature window E2E tests (`e2e/features.spec.ts`): 13 browser-level tests covering Wiki (create/edit/preview/search/navigate), Timeline (create/expand/linked chips/event bullets), and World Map (create/linked chips/multi-card) feature windows

### Changed
- Playwright config now runs tests with `workers: 1` to serialize execution and prevent SQLite write races between test files
