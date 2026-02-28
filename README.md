# ts-tailwindplus-downloader

A TypeScript CLI for downloading [TailwindPlus](https://tailwindcss.com/plus) (formerly Tailwind UI) components using Playwright browser automation. Includes a diff tool for tracking changes between versions.

> **Requires a valid TailwindPlus license.** This tool automates downloading components you have access to — it does not bypass any paywalls.

---

## Quick Start

```bash
# Run directly from GitHub (no clone needed)
npx github:BryantDesigns/ts-tailwindplus-downloader

# Or run from a specific release tag
npx github:BryantDesigns/ts-tailwindplus-downloader#v1.0.0
```

---

## Setup

### Prerequisites

- Node.js `^20.19.0 || ^22.12.0 || >=23`
- A valid TailwindPlus account
- Playwright Chromium (installed automatically via `postinstall`)

### Clone & install

```bash
git clone https://github.com/BryantDesigns/ts-tailwindplus-downloader.git
cd ts-tailwindplus-downloader
npm install   # also runs: npx playwright install --with-deps chromium
npm run build
```

---

## Usage

### Download components

```bash
# Download all authenticated components (prompts for login on first run)
npx tsx src/index.ts

# Save to a specific file
npx tsx src/index.ts --output=components.json

# Download free/unauthenticated components only
npx tsx src/index.ts --unauthenticated

# Write as a directory tree instead of a single JSON file
npx tsx src/index.ts --output-format=dir --output=components/

# Faster debugging: limit to 2 URLs
npx tsx src/index.ts --debug-short-test --output=test.json --log
```

### Credentials

On first run the CLI prompts for your TailwindPlus email/password. Your session is saved to `.ts-tailwindplus-downloader-session.json` and reused on subsequent runs.

To use a credentials file instead of interactive prompts:

```json
// .ts-tailwindplus-downloader-credentials.json
{ "email": "you@example.com", "password": "yourpassword" }
```

```bash
npx tsx src/index.ts --credentials=.ts-tailwindplus-downloader-credentials.json
```

---

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--output` | timestamped `.json` | Output file or directory path |
| `--output-format` | `json` | `json` (single file) or `dir` (directory tree) |
| `--workers` | `15` | Parallel browser pages (max 50) |
| `--overwrite` | `false` | Overwrite existing output without prompting |
| `--unauthenticated` | `false` | Download free components only (no login) |
| `--session` | `.ts-tailwindplus-downloader-session.json` | Session file path |
| `--credentials` | `.ts-tailwindplus-downloader-credentials.json` | Credentials file path |
| `--log` | — | Write debug log to `<output>.log` (or provide a path) |
| `--debug` | `false` | Enable verbose debug logging |
| `--debug-url-file` | — | Only download URLs listed in a file (`#` comments allowed) |
| `--debug-short-test` | — | Limit to 2 URLs for fast iteration |
| `--debug-headed` | — | Show browser window (headed mode) |
| `--debug-trace` | — | Save Playwright traces to `<output>.traces/` |

---

## Output Formats

### JSON (default)

A single file containing all components and metadata:

```json
{
  "downloader_version": "1.0.0",
  "version": "2026-02-27-120000",
  "downloaded_at": "2026-02-27T12:00:00.000Z",
  "component_count": 950,
  "download_duration": "420s",
  "tailwindplus": {
    "Application UI": {
      "Forms": {
        "Input Groups": {
          "name": "Input Groups",
          "snippets": [
            {
              "framework": "html",
              "tailwind_version": 4,
              "mode": "light",
              "code": "..."
            }
          ]
        }
      }
    }
  }
}
```

### Directory tree (`--output-format=dir`)

One file per snippet, organized as:
```
components/
  Application UI/
    Forms/
      Input Groups/
        html-v4-light.html
        react-v4-light.jsx
        vue-v4-light.vue
```

---

## Diff Tool

Compare two component JSON files to see what changed between TailwindPlus releases:

```bash
# Compare two downloads
npx tsx src/diff/tailwindplus-diff.ts --old=components-v1.json --new=components-v2.json

# Filter to a specific component
npx tsx src/diff/tailwindplus-diff.ts --old=v1.json --new=v2.json --filter="hero"
```

Short aliases: `twp-diff`, `ts-tailwindplus-diff`

---

## Skeleton Generator

Strip all code content from a downloaded file to create a lightweight index (useful for agent tooling):

```bash
npm run create-skeleton              # reads latest timestamped file → tailwindplus-skeleton.json
bash scripts/create-skeleton.sh components.json  # explicit source file
```

The skeleton replaces all code strings longer than 100 characters with `"<CONTENT>"`.

---

## Using with AI Assistants

The JSON output is designed to be consumed by [`tailwindplus-mcp-connector`](https://github.com/BryantDesigns/tailwindplus-mcp-connector), an MCP server that exposes TailwindPlus components to Claude, Cursor, and other AI coding assistants.

---

## Development

```bash
npm run build           # tsc → dist/
npm run build:watch     # watch mode

# Linting MUST use this form — plain `npx eslint` ignores eslint.config.cjs
npm run lint:fix
npx eslint --config eslint.config.cjs --fix src/path/to/file.ts
```

### Smoke test

Per [CLAUDE.md](CLAUDE.md) — always pass `--log` and use a prefixed output name:

```bash
npx tsx src/index.ts \
  --debug-url-file=test/smoke-test-urls.txt \
  --output=dev-smoke-test.json \
  --log
```

A successful authenticated run logs: `"10 URLs … 92 individual components"`.

---

## How It Works

1. **Discovery** — `discovery.ts` scrapes the TailwindPlus component index to build a URL list.
2. **Format detection** — `format-manager.ts` identifies available `framework × version × mode` combinations by sending InertiaJS XHR requests.
3. **Parallel download** — N `Worker` instances (default 15) each hold an isolated `BrowserContext` and pull jobs from a shared queue. Workers communicate with the orchestrator through a typed `WorkerHost` interface.
4. **Merge & write** — `output.ts` deep-merges each format's results (`mergeComponentData()`) so every component ends up with all its snippets, then writes to disk.

> **InertiaJS note:** The site's `data-page` attribute goes stale after any in-page navigation. The downloader always uses `page.goto()` for fresh data — never reads `data-page` after interactions. See [`docs/TAILWINDPLUS_ARCHITECTURE.md`](docs/TAILWINDPLUS_ARCHITECTURE.md) for full details.

---

## Acknowledgments

Inspired by [tailwindplus-downloader](https://github.com/RichardMCGirt/tailwindplus-downloader) by Richard Michael. This is an independent TypeScript rewrite with a different architecture and extended feature set.

---

## License

MIT
