# ts-tailwindplus-downloader

Download [TailwindPlus](https://tailwindcss.com/plus) components with a TypeScript CLI built on Playwright. The downloader can collect `html`, `react`, and `vue` snippets across Tailwind CSS `v3` and `v4`, with `system`, `light`, and `dark` modes where available, and includes a diff tool for comparing two downloaded snapshots.

> **Requires a valid TailwindPlus license.** This tool automates access to components you already have permission to use. It does not bypass paywalls or entitlements.

## Quick start

Run the downloader directly from GitHub:

```bash
# Run directly from GitHub (no clone needed)
npx github:BryantDesigns/ts-tailwindplus-downloader

# Or run from a specific release tag
npx github:BryantDesigns/ts-tailwindplus-downloader#v1.0.0
```

On the first run, the CLI prompts for your TailwindPlus credentials and saves a reusable session file.

By default, output is written to a timestamped JSON file in the current directory:

```text
tailwindplus-components-YYYY-MM-DD-HHMMSS.json
```

## Setup

`npx` requires no clone, but you still need a compatible Node.js runtime and Playwright's Chromium browser dependencies.

### Prerequisites

- Node.js `^20.19.0 || ^22.12.0 || >=23`
- A valid TailwindPlus account for authenticated downloads
- Playwright Chromium, installed automatically during `npm install` when working from a clone

### Clone and build

If you want to run from source or contribute:

```bash
git clone https://github.com/BryantDesigns/ts-tailwindplus-downloader.git
cd ts-tailwindplus-downloader
npm install
npm run build
```

Published bin entries:

- `ts-tailwindplus-downloader`
- `twp-downloader`
- `ts-tailwindplus-diff`
- `twp-diff`
- `twp-create-skeleton`

## Common usage

### Download components

```bash
# Download all authenticated components
npx tsx src/index.ts

# Save to a specific JSON file
npx tsx src/index.ts --output=components.json

# Write a directory tree instead of a single JSON file
npx tsx src/index.ts --output-format=dir --output=components/

# Download only free components
npx tsx src/index.ts --unauthenticated

# Restrict the download scope
npx tsx src/index.ts --frameworks=react --versions=4 --modes=system

# Use a JSON config file for argument overrides
npx tsx src/index.ts --config=filter.json

# Fast debugging pass: limit to 2 URLs and save a log
npx tsx src/index.ts --debug-short-test --output=test.json --log
```

### Authentication

On the first authenticated run, the CLI prompts for your TailwindPlus email and password. It then saves a reusable session file at:

```text
.ts-tailwindplus-downloader-session.json
```

You can also provide credentials via JSON instead of interactive prompts:

```json
{
  "email": "you@example.com",
  "password": "yourpassword"
}
```

Use it with:

```bash
npx tsx src/index.ts --credentials=.ts-tailwindplus-downloader-credentials.json
```

Default credential file path:

```text
.ts-tailwindplus-downloader-credentials.json
```

## CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--output` | timestamped `.json` | Output file or directory path |
| `--output-format` | `json` | `json` for a single file, `dir` for a directory tree |
| `--frameworks` | all | Comma-separated frameworks such as `react,vue,html` |
| `--versions` | all | Comma-separated Tailwind versions such as `4,3` |
| `--modes` | all | Comma-separated modes such as `light,dark,system` |
| `--config` | none | Path to a JSON config file for argument overrides |
| `--workers` | `15` | Number of pages to download in parallel, up to 50 |
| `--overwrite` | `false` | Overwrite an existing output path without prompting |
| `--unauthenticated` | `false` | Download free components only |
| `--session` | `.ts-tailwindplus-downloader-session.json` | Session file path |
| `--credentials` | `.ts-tailwindplus-downloader-credentials.json` | Credentials file path |
| `--log` | none | Write a log to `<output>.log`, or provide an explicit path |
| `--debug` | `false` | Enable verbose debug logging |
| `--debug-url-file` | none | Only download URLs listed in a file |
| `--debug-short-test` | none | Limit the run to 2 URLs |
| `--debug-headed` | none | Show the browser window |
| `--debug-trace` | none | Save Playwright traces to `<output>.traces/` |

Use `--help` to see the full CLI help text:

```bash
npx github:BryantDesigns/ts-tailwindplus-downloader --help
```

## Output formats

Both output formats include metadata such as downloader version, timestamp, and component count.

### JSON output

The default mode writes one JSON file containing metadata and the full nested component tree.

Example shape:

```json
{
  "downloader_version": "1.0.0",
  "version": "2026-04-18-120000",
  "downloaded_at": "2026-04-18T12:00:00.000Z",
  "component_count": 950,
  "download_duration": "420s",
  "tailwindplus": {
    "Application UI": {
      "Forms": {
        "Input Groups": {
          "Input with leading icon": {
            "name": "Input with leading icon",
            "snippets": [
              {
                "name": "react",
                "language": "jsx",
                "version": 4,
                "mode": "light",
                "supportsDarkMode": true,
                "preview": "https://...",
                "code": "..."
              }
            ]
          }
        }
      }
    }
  }
}
```

This format works well with:

- `jq`
- the TailwindPlus MCP server
- scripts that need the full dataset in one file

### Directory output

Use `--output-format=dir` to write each snippet as its own file.

```bash
npx github:BryantDesigns/ts-tailwindplus-downloader --output-format=dir --output ./twp
```

Directory layout:

```text
twp/
  metadata.json
  Application UI/
    Forms/
      Input Groups/
        Input with leading icon/
          v4/
            react-light.jsx
            react-dark.jsx
            html-light.html
```

This format is useful when you want tools or agents to browse component files directly without loading the full JSON export into context.

## Diff tool

Compare two downloader JSON files to see what changed between snapshots.

Basic usage:

```bash
# Compare the two most recent timestamped downloads in the current directory
npx tsx src/diff/tailwindplus-diff.ts --old=components-v1.json --new=components-v2.json

# Compare specific files
npx tsx src/diff/tailwindplus-diff.ts --old=v1.json --new=v2.json --filter="hero"
```

Short aliases: `twp-diff`, `ts-tailwindplus-diff`

## Skeleton generator

The full JSON export is large for LLM context. The skeleton generator strips large code blocks so the file can be used as a lightweight index of available components.

```bash
# In the repo
npm run create-skeleton
npm run create-skeleton -- ./tailwindplus-skeleton.json

# Via npx
npx --package=github:BryantDesigns/ts-tailwindplus-downloader -- twp-create-skeleton
npx --package=github:BryantDesigns/ts-tailwindplus-downloader -- twp-create-skeleton ./tailwindplus-skeleton.json
```

The skeleton replaces all code strings longer than 100 characters with `"<CONTENT>"`.

## Using with agents

### MCP server

> [!TIP]
> Use the [TailwindPlus MCP server](https://github.com/BryantDesigns/tailwindplus-mcp-connector).  It uses the JSON file from the downloader.

Ask for a component:

```
> I need a simple one-line search input to put in the app header.

 mcp-tailwindplus - Get Component by Full Name (MCP)(full_name: "Application UI.Forms.Input Groups.Input with leading icon", framework: "react", tailwind_version: "4")
  ⎿  {
       "version": "2025-07-14-204017",
       "full_name": "Application UI.Forms.Input Groups.Input with leading icon",
     … +15 lines (ctrl+r to expand)

 mcp-tailwindplus - Get Component by Full Name (MCP)(full_name: "Application UI.Forms.Input Groups.Input with keyboard shortcut", framework: "react", tailwind_version: "4")
  ⎿  {
       "version": "2025-07-14-204017",
       "full_name": "Application UI.Forms.Input Groups.Input with keyboard shortcut",
     … +16 lines (ctrl+r to expand)


 Perfect! Here are two ideal options for a header search input:

  1. Input with Leading Icon

  Application UI.Forms.Input Groups.Input with leading icon
  - Simple search input with magnifying glass icon
  - Just swap the EnvelopeIcon for MagnifyingGlassIcon
  - Clean, compact design perfect for headers

  2. Input with Keyboard Shortcut

  Application UI.Forms.Input Groups.Input with keyboard shortcut
  - Shows "⌘K" shortcut hint
  - Modern search UX that users expect
  - Great for power users

  For a header, I'd recommend the first one with a search icon - it's the most recognizable and space-efficient.
```

### Agent skill

The repo includes a skill in [`contrib/tailwind-plus/`](contrib/tailwind-plus/) that allows the agent to automatically
browse and read components from the directory output when asked to build UI.

Install it by symlinking into a skills directory:

```bash
# Global
ln -s /path/to/ts-tailwindplus-downloader/contrib/tailwind-plus ~/.claude/skills/tailwind-plus

# Project
ln -s /path/to/ts-tailwindplus-downloader/contrib/tailwind-plus .claude/skills/tailwind-plus
```

### Skeleton file

The full JSON file is too large for LLM context. A skeleton file contains component names without
code, allowing the LLM to search names and use `jq` to fetch specific component code on demand via a
command execution MCP server.

```bash
# Within the repo:
npm run create-skeleton
npm run create-skeleton -- twp.json   # specific file (note: -- is required by npm)

# Via npx:
npx --package=github:bryantdesigns/ts-tailwindplus-downloader#latest -- twp-create-skeleton
npx --package=github:bryantdesigns/ts-tailwindplus-downloader#latest -- twp-create-skeleton twp.json
```

#### Querying a downloaded file with `jq`

Once you know the component path, you can fetch only the snippet you need:

```bash
jq '.tailwindplus.Marketing."Page Sections"."Hero Sections"."Simple centered".snippets[] | select(.name == "html" and .version == 4) | .code' --raw-output ./twp.json
```

## Development

When working from a clone, run the source entry points directly:

```bash
npx tsx src/index.ts
npx tsx src/index.ts --output=components.json
npx tsx src/index.ts --output-format=dir --output=components/
npx tsx src/index.ts --unauthenticated
```

Build and lint:

```bash
npm run build
npm run build:watch
npm run lint:fix
npx eslint --config eslint.config.cjs --fix src/path/to/file.ts
```

### Smoke test

The repo includes a smoke test script:

```bash
npm run smoke-test
```

For a focused manual smoke test, use the debug URL file and enable logging:

```bash
npx tsx src/index.ts \
  --debug-url-file=test/smoke-test-urls.txt \
  --output=dev-smoke-test.json \
  --log
```

A successful authenticated run logs:

```text
10 URLs ... 92 individual components
```

## How it works

1. The downloader discovers component page URLs from TailwindPlus.
2. It validates or creates an authenticated session when needed.
3. It iterates through the requested format combinations.
4. Parallel workers download component data using isolated Playwright browser contexts.
5. Results are merged and written either to a single JSON file or a directory tree.

Architecture notes:

- Authenticated and unauthenticated downloads use different extraction paths.
- Workers use separate browser contexts so parallel runs do not interfere with one another.
- Output preserves the TailwindPlus product, category, subcategory, and component hierarchy.

For deeper implementation detail, see [`docs/TAILWINDPLUS_ARCHITECTURE.md`](docs/TAILWINDPLUS_ARCHITECTURE.md).
