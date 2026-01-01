/**
 * Storage Manager
 *
 * Provides CRUD operations for extension storage.
 * Handles sync/local storage distribution and migrations.
 */

import {
  GlobalSettings,
  Preset,
  SiteConfig,
  SiteMode,
  SerializablePipelineState,
  SessionCacheEntry,
  SyncStorage,
  LocalStorage,
  DEFAULT_SETTINGS,
  DEFAULT_SYNC_STORAGE,
  DEFAULT_LOCAL_STORAGE,
  STORAGE_VERSION,
  PresetExport,
} from './schema';

// =============================================================================
// Storage Manager
// =============================================================================

/**
 * Manages all persistent storage for the extension.
 * Singleton pattern - use StorageManager.getInstance().
 */
export class StorageManager {
  private static instance: StorageManager | null = null;

  private constructor() {}

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  // ===========================================================================
  // Initialization & Migration
  // ===========================================================================

  /**
   * Initialize storage, running migrations if needed.
   * Call this once when extension starts.
   */
  async initialize(): Promise<void> {
    const sync = await this.getSyncStorage();

    if (!sync.version || sync.version < STORAGE_VERSION) {
      await this.migrate(sync.version ?? 0, STORAGE_VERSION);
    }
  }

  /**
   * Run storage migrations between versions.
   */
  private async migrate(fromVersion: number, toVersion: number): Promise<void> {
    console.log(`[Storage] Migrating from v${fromVersion} to v${toVersion}`);

    // Version 0 -> 1: Initial schema, no migration needed
    if (fromVersion === 0 && toVersion >= 1) {
      // Just set defaults
      await chrome.storage.sync.set({
        version: STORAGE_VERSION,
        settings: DEFAULT_SETTINGS,
        presets: {},
      });
      await chrome.storage.local.set({
        siteConfigs: {},
        sessionCache: {},
      });
    }

    // Future migrations would go here:
    // if (fromVersion < 2 && toVersion >= 2) { ... }

    console.log('[Storage] Migration complete');
  }

  // ===========================================================================
  // Raw Storage Access
  // ===========================================================================

  private async getSyncStorage(): Promise<Partial<SyncStorage>> {
    return chrome.storage.sync.get(null) as Promise<Partial<SyncStorage>>;
  }

  private async getLocalStorage(): Promise<Partial<LocalStorage>> {
    return chrome.storage.local.get(null) as Promise<Partial<LocalStorage>>;
  }

  // ===========================================================================
  // Settings
  // ===========================================================================

  /**
   * Get current global settings.
   */
  async getSettings(): Promise<GlobalSettings> {
    const sync = await this.getSyncStorage();
    return sync.settings ?? DEFAULT_SETTINGS;
  }

  /**
   * Update global settings (partial update).
   */
  async updateSettings(partial: Partial<GlobalSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = deepMerge(current, partial);
    await chrome.storage.sync.set({ settings: updated });
  }

  /**
   * Reset settings to defaults.
   */
  async resetSettings(): Promise<void> {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }

  // ===========================================================================
  // Presets
  // ===========================================================================

  /**
   * Get all presets.
   */
  async getPresets(): Promise<Preset[]> {
    const sync = await this.getSyncStorage();
    const presets = sync.presets ?? {};
    return Object.values(presets).sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  /**
   * Get a single preset by ID.
   */
  async getPreset(id: string): Promise<Preset | null> {
    const sync = await this.getSyncStorage();
    return sync.presets?.[id] ?? null;
  }

  /**
   * Save a preset (create or update).
   */
  async savePreset(preset: Preset): Promise<void> {
    const sync = await this.getSyncStorage();
    const presets = { ...sync.presets, [preset.id]: preset };
    await chrome.storage.sync.set({ presets });
  }

  /**
   * Delete a preset.
   */
  async deletePreset(id: string): Promise<void> {
    const sync = await this.getSyncStorage();
    const presets = { ...sync.presets };
    delete presets[id];
    await chrome.storage.sync.set({ presets });
  }

  /**
   * Export all presets as JSON string.
   */
  async exportPresets(): Promise<string> {
    const presets = await this.getPresets();
    const exportData: PresetExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'universal-audio-filter',
      presets: presets.filter(p => !p.isFactory), // Don't export factory presets
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import presets from JSON string.
   * Returns count of imported presets and any errors.
   */
  async importPresets(json: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    try {
      const data = JSON.parse(json) as PresetExport;

      // Validate format
      if (data.app !== 'universal-audio-filter') {
        throw new Error('Invalid preset file: wrong application identifier');
      }
      if (!Array.isArray(data.presets)) {
        throw new Error('Invalid preset file: missing presets array');
      }

      // Get existing presets for conflict detection
      const existing = await this.getPresets();
      const existingNames = new Set(existing.map(p => p.name));

      for (const preset of data.presets) {
        try {
          // Validate preset structure
          if (!preset.name || !preset.pipeline?.filters) {
            errors.push(`Skipped invalid preset: ${preset.name || 'unnamed'}`);
            skipped++;
            continue;
          }

          // Generate new ID to avoid conflicts
          const newPreset: Preset = {
            ...preset,
            id: generateId(),
            isFactory: false,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
          };

          // Handle name conflicts by appending number
          if (existingNames.has(newPreset.name)) {
            let suffix = 2;
            while (existingNames.has(`${preset.name} (${suffix})`)) {
              suffix++;
            }
            newPreset.name = `${preset.name} (${suffix})`;
          }

          await this.savePreset(newPreset);
          existingNames.add(newPreset.name);
          imported++;
        } catch (err) {
          errors.push(`Failed to import "${preset.name}": ${err}`);
          skipped++;
        }
      }
    } catch (err) {
      errors.push(`Failed to parse import file: ${err}`);
    }

    return { imported, skipped, errors };
  }

  // ===========================================================================
  // Site Configurations
  // ===========================================================================

  /**
   * Get all site configurations.
   */
  async getAllSiteConfigs(): Promise<SiteConfig[]> {
    const local = await this.getLocalStorage();
    return Object.values(local.siteConfigs ?? {});
  }

  /**
   * Get configuration for a specific hostname.
   * Checks exact match first, then wildcard patterns.
   */
  async getSiteConfig(hostname: string): Promise<SiteConfig | null> {
    const local = await this.getLocalStorage();
    const configs = local.siteConfigs ?? {};

    // Exact match first
    if (configs[hostname]) {
      return configs[hostname];
    }

    // Check wildcard patterns
    for (const [pattern, config] of Object.entries(configs)) {
      if (matchHostnamePattern(pattern, hostname)) {
        return config;
      }
    }

    return null;
  }

  /**
   * Save a site configuration.
   */
  async setSiteConfig(config: SiteConfig): Promise<void> {
    const local = await this.getLocalStorage();
    const configs = { ...local.siteConfigs, [config.pattern]: config };
    await chrome.storage.local.set({ siteConfigs: configs });
  }

  /**
   * Delete a site configuration.
   */
  async deleteSiteConfig(pattern: string): Promise<void> {
    const local = await this.getLocalStorage();
    const configs = { ...local.siteConfigs };
    delete configs[pattern];
    await chrome.storage.local.set({ siteConfigs: configs });
  }

  /**
   * Get the effective mode for a hostname.
   * Falls back to default if no site config exists.
   */
  async getEffectiveMode(hostname: string): Promise<SiteMode> {
    const siteConfig = await this.getSiteConfig(hostname);
    if (siteConfig) {
      return siteConfig.mode;
    }
    const settings = await this.getSettings();
    return settings.defaultSiteMode;
  }

  // ===========================================================================
  // Session Cache
  // ===========================================================================

  /**
   * Cache pipeline state for a tab.
   */
  async cacheSession(
    tabId: number,
    pipeline: SerializablePipelineState,
    hostname: string
  ): Promise<void> {
    const local = await this.getLocalStorage();
    const cache = { ...local.sessionCache };
    cache[String(tabId)] = {
      tabId,
      pipeline,
      hostname,
      cachedAt: Date.now(),
    };
    await chrome.storage.local.set({ sessionCache: cache });
  }

  /**
   * Restore cached pipeline state for a tab.
   */
  async restoreSession(tabId: number): Promise<SessionCacheEntry | null> {
    const local = await this.getLocalStorage();
    return local.sessionCache?.[String(tabId)] ?? null;
  }

  /**
   * Clear session cache for a tab.
   */
  async clearSession(tabId: number): Promise<void> {
    const local = await this.getLocalStorage();
    const cache = { ...local.sessionCache };
    delete cache[String(tabId)];
    await chrome.storage.local.set({ sessionCache: cache });
  }

  /**
   * Clear all stale session cache entries.
   * Called periodically to clean up closed tabs.
   */
  async cleanupSessionCache(activeTabIds: number[]): Promise<void> {
    const local = await this.getLocalStorage();
    const cache = { ...local.sessionCache };
    const activeSet = new Set(activeTabIds.map(String));

    let cleaned = 0;
    for (const tabId of Object.keys(cache)) {
      if (!activeSet.has(tabId)) {
        delete cache[tabId];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await chrome.storage.local.set({ sessionCache: cache });
      console.log(`[Storage] Cleaned ${cleaned} stale session cache entries`);
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique ID for presets.
 */
function generateId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Deep merge two objects.
 * Arrays are replaced, not merged.
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Match a hostname against a pattern.
 * Supports:
 * - Exact match: 'youtube.com' matches 'youtube.com'
 * - Wildcard subdomain: '*.youtube.com' matches 'www.youtube.com', 'music.youtube.com'
 * - Wildcard all: '*' matches everything
 *
 * TODO: This is a good place for user contribution - the pattern matching logic
 * has trade-offs between simplicity and power. Consider:
 * - Should '*.example.com' match 'example.com' itself?
 * - Should we support more complex patterns like 'video.*.com'?
 */
function matchHostnamePattern(pattern: string, hostname: string): boolean {
  // Wildcard all
  if (pattern === '*') {
    return true;
  }

  // Exact match
  if (pattern === hostname) {
    return true;
  }

  // Wildcard subdomain: *.example.com
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(2);
    // Match subdomains (www.example.com) but not the base domain itself
    return hostname.endsWith(`.${baseDomain}`);
  }

  return false;
}

// =============================================================================
// Export singleton instance
// =============================================================================

export const storage = StorageManager.getInstance();
