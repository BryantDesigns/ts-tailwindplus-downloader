# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Security Warnings
- Never use the timeout command to run anything.
- Do not use pkill with node and this script.

## Logging Best Practices
- Never console.log directly, always use the logger object if one exists.

## Build
- Compile TypeScript: `npm run build`
- Watch mode: `npm run build:watch`
- Output goes to `dist/`; ESM project (`"type": "module"`), so imports use `.js` extensions even for `.ts` source files.

## Linting
- Run eslint as: `npm run lint:fix` (uses `eslint.config.cjs`; plain `npx eslint` won't pick up the config)
- To lint a specific file: `npx eslint --config eslint.config.cjs --fix <FILE>`

## Testing Guidelines
- When testing the downloader scripts, use `--output=<SOME TEST FILE> --log`.  The `--log` flag creates a debug log with the same basename but `.log` suffix.
- Smoke-test with the URL file and a prefixed output file:

```bash
npx github:BryantDesigns/ts-tailwindplus-downloader#<tag> \
  --debug-url-file=test/smoke-test-urls.txt \
  --output=claude_exp-smoke-test.json \
  --log
```

A successful run logs: "10 URLs … 92 individual components".

## Commit Message Format

Use conventional commits:
- `feat:` — new user-visible feature
- `fix:` — bug fix
- `perf:` — performance improvement
- `refactor:` — code restructuring, no behavior change
- `chore:` — maintenance, deps, tooling
- `docs:` — documentation only
- `test:` — tests only
- Add `BREAKING CHANGE: <description>` in the commit body for breaking changes

Multi-part changes: use bullet points in the body as before.

## Architecture Overview

### Source Layout (`src/`)

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | CLI entry point — thin arg parsing only, delegates to `TailwindPlusDownloader` |
| `src/config.ts` | Single `createConfig()` factory — all URLs, CSS selectors, timeouts, format combos |
| `src/types.ts` | All shared TypeScript interfaces (`DownloaderOptions`, `ComponentData`, `Snippet`, etc.) |
| `src/errors.ts` | `DownloaderError` custom error class |
| `src/logger.ts` | `Logger` / `PrefixedLogger` — file + console logging, never `console.log` directly |
| `src/models/format.ts` | `Format` value object (framework × version × mode) |
| `src/models/reflecting-array.ts` | Utility array type |
| `src/downloader/downloader.ts` | `TailwindPlusDownloader` — main orchestrator; thin coordinator |
| `src/downloader/auth.ts` | Login, session save/load |
| `src/downloader/discovery.ts` | URL discovery from the TailwindPlus navigation tree |
| `src/downloader/format-manager.ts` | Detect/set format via Playwright UI controls |
| `src/downloader/output.ts` | Merge, deduplicate, write JSON or directory-tree output |
| `src/worker/worker.ts` | `Worker` class — pulls jobs from queue, owns its own `BrowserContext` |
| `src/worker/authenticated.ts` | Extracts components by reading `data-page` JSON (fast path) |
| `src/worker/unauthenticated.ts` | Extracts components by changing UI controls and capturing Inertia responses |
| `src/browser/page-functions.ts` | Page-evaluated functions (e.g., `snippetsOfRequiredFormat`) |
| `src/browser/tracing.ts` | Playwright trace start/stop helpers |
| `src/diff/tailwindplus-diff.ts` | Standalone diff CLI — compares two downloaded JSON snapshots |
| `src/utils/json-sorting.ts` | Deterministic JSON key sorting for stable output |

### Bin Entries

| Command | Entry |
|---------|-------|
| `twp-downloader` / `ts-tailwindplus-downloader` | `dist/index.js` |
| `twp-diff` / `ts-tailwindplus-diff` | `dist/diff/tailwindplus-diff.js` |
| `twp-create-skeleton` | `scripts/create-skeleton.sh` |

### Data Flow

1. **Discovery** — `discovery.ts` fetches the navigation tree from `tailwindcss.com/plus/ui-blocks` and returns all component-page URLs.
2. **Auth** — `auth.ts` loads a saved session or logs in with credentials and saves the session.
3. **Format loop** — `TailwindPlusDownloader._processFormats()` iterates over all 18 format combos (3 frameworks × 2 Tailwind versions × 3 modes; 6 for eCommerce with no mode). For **authenticated** mode: sets account-level format once via `format-manager.ts`, then runs all Workers. For **unauthenticated** mode: Workers collect all 18 formats per page in a single visit.
4. **Workers** — each Worker owns an isolated `BrowserContext` cloned from the authenticated session, pulls `Job` objects (one per URL) off the shared `jobQueue`, and calls the appropriate extraction method.
5. **Output** — `output.ts` merges per-worker results into `ComponentData` (Product → Category → Subcategory → ComponentName → ComponentEntry with snippets), deduplicates eCommerce entries, then writes JSON or a directory tree.

### Key Design Decisions

**InertiaJS extraction strategy**: The target site uses InertiaJS (SPA-over-SSR). On a fresh `page.goto()`, component code is embedded in the `<div id="app" data-page='...'>` JSON attribute. Workers read this attribute directly rather than interacting with UI controls — this is only reliable for authenticated users where format is stored account-side. See `docs/TAILWINDPLUS_ARCHITECTURE.md` for the full explanation.

**Authenticated vs unauthenticated**: Two separate extraction code paths exist in `worker/authenticated.ts` and `worker/unauthenticated.ts`. Authenticated mode is simpler (reads `data-page`). Unauthenticated mode changes framework/version/mode controls and captures Inertia JSON responses per component.

**Worker isolation**: Each `Worker` creates a new `BrowserContext` using cloned session cookies so Workers run in parallel without interfering with each other's page state.

**ComponentData type**: `Record<Product, Record<Category, Record<Subcategory, Record<ComponentName, ComponentEntry>>>>` — four levels of nesting, each `ComponentEntry` holds a `snippets` array covering all formats.

**CSS selectors**: All selectors live in `config.ts` (`selectors.*`). When the TailwindPlus site changes its DOM structure, this is the first place to update.
