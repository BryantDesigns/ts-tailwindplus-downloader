# ts-tailwindplus-downloader

A downloader for TailwindPlus components with diff comparison tools.

## Overview

CLI tool for downloading and managing TailwindPlus (Tailwind UI) components using Playwright-based browser automation. Includes a diff comparison tool for tracking component changes between versions.

## Features

- **Component Downloader** — Automated download of TailwindPlus components
- **Diff Tool** — Compare component versions to identify changes
- **Skeleton Generator** — Create project scaffolding from component structures

## Prerequisites

- Node.js `^20.19.0 || ^22.12.0 || >=23`
- A valid TailwindPlus account

## Installation

```bash
npm install
```

> **Note**: `postinstall` automatically installs Chromium for Playwright.

## Usage

```bash
# Download components
npx tailwindplus-downloader

# Compare component versions
npx tailwindplus-diff

# Create skeleton structure
npm run create-skeleton
```

## Development

```bash
# Run linter
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Run smoke tests
npm run smoke-test
```

## License

MIT
