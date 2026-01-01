/**
 * Storage Schema
 *
 * Type definitions for all persistent state.
 * This file defines the contract between storage, presets, and UI.
 *
 * Storage distribution:
 * - chrome.storage.sync: settings, presets (synced across devices, 102KB limit)
 * - chrome.storage.local: siteConfigs, sessionCache (device-specific, no limit)
 */

// =============================================================================
// Filter State (for serialization)
// =============================================================================

/**
 * Serializable state for a single filter instance.
 * Unlike FilterState in base.ts, this includes the type ID for reconstruction.
 */
export interface SerializableFilterState {
  /** Filter type ID from registry (e.g., 'parametric-eq', 'delay') */
  typeId: string;

  /** Unique instance ID (e.g., 'delay-1-1704067200000') */
  instanceId: string;

  /** Whether this filter instance is enabled (not bypassed) */
  enabled: boolean;

  /** Parameter values keyed by parameter name */
  parameters: Record<string, number | boolean>;
}

/**
 * Serializable state for an entire filter pipeline.
 * Order of filters array matches the processing order.
 */
export interface SerializablePipelineState {
  /** Ordered list of filter states */
  filters: SerializableFilterState[];
}

// =============================================================================
// Presets
// =============================================================================

/**
 * A saved filter chain configuration.
 * Users can save, load, share, and import/export presets.
 */
export interface Preset {
  /** Unique preset ID (UUID or timestamp-based) */
  id: string;

  /** User-visible name */
  name: string;

  /** Optional description */
  description?: string;

  /** When preset was created (Unix timestamp ms) */
  createdAt: number;

  /** When preset was last modified (Unix timestamp ms) */
  modifiedAt: number;

  /** The filter chain state */
  pipeline: SerializablePipelineState;

  /** Optional tags for organization */
  tags?: string[];

  /** Whether this is a built-in factory preset (read-only) */
  isFactory?: boolean;
}

/**
 * Format for preset import/export JSON files.
 */
export interface PresetExport {
  /** Export format version */
  version: 1;

  /** When this export was created */
  exportedAt: string;

  /** Application identifier */
  app: 'universal-audio-filter';

  /** Array of presets */
  presets: Preset[];
}

// =============================================================================
// Per-Site Configuration
// =============================================================================

/**
 * Behavior mode for a site.
 * - 'auto-apply': Automatically apply saved preset/settings when visiting
 * - 'neutral': Start with no filters, user must manually load
 */
export type SiteMode = 'auto-apply' | 'neutral';

/**
 * Configuration for a specific site or site pattern.
 */
export interface SiteConfig {
  /** Hostname or pattern (e.g., 'youtube.com', '*.example.com') */
  pattern: string;

  /** Behavior mode for this site */
  mode: SiteMode;

  /** Preset ID to apply when mode is 'auto-apply' */
  presetId?: string;

  /** Alternative: inline pipeline state (for one-off site settings) */
  inlinePipeline?: SerializablePipelineState;

  /** When this config was last updated */
  updatedAt: number;
}

// =============================================================================
// Global Settings
// =============================================================================

/**
 * UI-related preferences.
 */
export interface UISettings {
  /** IDs of sections that should remain collapsed */
  collapsedSections: string[];

  /** Whether to show advanced parameters by default */
  showAdvanced: boolean;

  /** Theme preference (follows system by default) */
  theme: 'system' | 'light' | 'dark';
}

/**
 * Global extension settings.
 */
export interface GlobalSettings {
  /** Default behavior for sites without specific config */
  defaultSiteMode: SiteMode;

  /** Default preset ID to use when auto-apply is enabled */
  defaultPresetId?: string;

  /** UI preferences */
  ui: UISettings;

  /** Whether to show CPU usage indicators in filter browser */
  showCpuIndicators: boolean;

  /** Whether to show debug section in popup */
  showDebugSection: boolean;
}

// =============================================================================
// Session Cache (volatile, per-tab state)
// =============================================================================

/**
 * Cached pipeline state for a browser tab.
 * Used to restore state when popup reopens.
 */
export interface SessionCacheEntry {
  /** Tab ID */
  tabId: number;

  /** Current pipeline state */
  pipeline: SerializablePipelineState;

  /** Site hostname */
  hostname: string;

  /** When this was cached */
  cachedAt: number;
}

// =============================================================================
// Storage Root Structures
// =============================================================================

/**
 * Data stored in chrome.storage.sync.
 * Limited to 102KB total, 8KB per item.
 * Synced across user's devices.
 */
export interface SyncStorage {
  /** Storage schema version for migrations */
  version: number;

  /** Global extension settings */
  settings: GlobalSettings;

  /** User presets (keyed by preset ID) */
  presets: Record<string, Preset>;
}

/**
 * Data stored in chrome.storage.local.
 * No size limit, device-specific.
 */
export interface LocalStorage {
  /** Per-site configurations (keyed by pattern) */
  siteConfigs: Record<string, SiteConfig>;

  /** Session cache for tabs (keyed by tab ID as string) */
  sessionCache: Record<string, SessionCacheEntry>;
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Default global settings for new installations.
 */
export const DEFAULT_SETTINGS: GlobalSettings = {
  defaultSiteMode: 'neutral',
  defaultPresetId: undefined,
  ui: {
    collapsedSections: [],
    showAdvanced: false,
    theme: 'system',
  },
  showCpuIndicators: true,
  showDebugSection: false,
};

/**
 * Current storage schema version.
 * Increment when making breaking changes to storage format.
 */
export const STORAGE_VERSION = 1;

/**
 * Default sync storage state.
 */
export const DEFAULT_SYNC_STORAGE: SyncStorage = {
  version: STORAGE_VERSION,
  settings: DEFAULT_SETTINGS,
  presets: {},
};

/**
 * Default local storage state.
 */
export const DEFAULT_LOCAL_STORAGE: LocalStorage = {
  siteConfigs: {},
  sessionCache: {},
};
