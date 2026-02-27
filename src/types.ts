/**
 * Shared TypeScript interfaces and types for the TailwindPlus Downloader.
 *
 * This module contains the core domain types used across all modules.
 * Import from here rather than defining types inline to keep contracts
 * consistent and discoverable.
 */

import type { BrowserContext, Browser } from 'playwright';

// =============================================================================
// Configuration Types
// =============================================================================

export interface DownloaderConfig {
    readonly outputBase: string;
    readonly version: string;
    readonly output: string;
    readonly session: string;
    readonly credentials: string;
    readonly urls: {
        readonly base: string;
        readonly login: string;
        readonly plus: string;
        readonly discovery: string;
        readonly eCommerce: string;
    };
    readonly selectors: {
        readonly codeButtons: string;
        readonly modeInput: string;
        readonly frameworkSelect: string;
        readonly versionSelect: string;
    };
    readonly timeout: number;
    readonly retries: {
        readonly maxRetries: number;
    };
    readonly download: {
        readonly frameworks: readonly string[];
        readonly versions: readonly number[];
        readonly modes: readonly string[];
    };
}

// =============================================================================
// CLI Options
// =============================================================================

export interface DownloaderOptions {
    output: string;
    outputFormat: 'json' | 'dir';
    overwrite: boolean;
    workers: number;
    session: string;
    credentials: string;
    log?: string | boolean;
    debug: boolean;
    debugShortTest?: boolean;
    debugUrlFile?: string;
    debugHeaded?: boolean;
    debugTrace?: boolean;
    unauthenticated: boolean;
}

// =============================================================================
// Job Queue
// =============================================================================

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
    url: string;
    status: JobStatus;
    retryCount: number;
    data?: ComponentData;
    error?: string;
}

// =============================================================================
// Component Data
// =============================================================================

export interface Snippet {
    code: string;
    name: string;
    language: string;
    version: number;
    mode: string | null;
    supportsDarkMode: boolean;
    preview: string;
}

export interface ComponentEntry {
    name: string;
    snippets: Snippet[];
}

/** Nested structure: Product → Category → Subcategory → ComponentName → ComponentEntry */
export type ComponentData = Record<string, Record<string, Record<string, Record<string, ComponentEntry>>>>;

// =============================================================================
// Credentials
// =============================================================================

export type CredentialSource = 'file' | 'prompt';

export interface Credentials {
    email: string;
    password: string;
    source: CredentialSource;
}

// =============================================================================
// Discovery
// =============================================================================

export interface DiscoveryResult {
    urls: string[];
    urlCount: number;
    componentCount: number;
}

// =============================================================================
// Browser Context
// =============================================================================

export interface BrowserResources {
    browser: Browser;
    context: BrowserContext;
    contextOptions: Record<string, unknown>;
}

// =============================================================================
// Metadata
// =============================================================================

export interface DownloadMetadata {
    component_count: number;
    download_duration: string;
    downloaded_at: string;
    downloader_version: string;
    version: string;
}
