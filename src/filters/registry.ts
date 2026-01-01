/**
 * Filter Registry
 *
 * Central registry for all available audio filters. Handles:
 * - Filter discovery and registration
 * - Lazy loading of filter implementations
 * - Category organization
 * - Factory pattern for filter instantiation
 */

import type { AudioFilter, FilterParameter } from './base';

/**
 * Filter category for UI organization
 */
export type FilterCategory =
  | 'pitch'      // Pitch shifting, tempo
  | 'eq'         // Equalization
  | 'dynamics'   // Compressor, limiter, gate
  | 'time'       // Delay, reverb
  | 'modulation' // Chorus, flanger, phaser
  | 'utility'    // Gain, pan, mono/stereo
  | 'ffmpeg';    // FFmpeg-based filters

/**
 * Metadata about a registered filter
 */
export interface FilterInfo {
  /** Unique identifier */
  id: string;

  /** Display name for UI */
  displayName: string;

  /** Short description */
  description: string;

  /** Category for organization */
  category: FilterCategory;

  /** Parameter definitions (for UI generation before instantiation) */
  parameters: FilterParameter[];

  /** Whether filter requires WASM */
  requiresWasm: boolean;

  /** Approximate CPU usage: 'low' | 'medium' | 'high' */
  cpuUsage: 'low' | 'medium' | 'high';

  /** Tags for search */
  tags: string[];
}

/**
 * Filter factory function type
 */
type FilterFactory = () => AudioFilter;

/**
 * Registration entry combining metadata and factory
 */
interface FilterRegistration {
  info: FilterInfo;
  factory: FilterFactory;
}

/**
 * Central registry for audio filters
 */
class FilterRegistryImpl {
  private filters: Map<string, FilterRegistration> = new Map();

  /**
   * Register a filter with the registry
   */
  register(info: FilterInfo, factory: FilterFactory): void {
    if (this.filters.has(info.id)) {
      console.warn(`[FilterRegistry] Overwriting existing filter: ${info.id}`);
    }
    this.filters.set(info.id, { info, factory });
  }

  /**
   * Get info about a specific filter
   */
  getInfo(id: string): FilterInfo | undefined {
    return this.filters.get(id)?.info;
  }

  /**
   * Get all registered filter infos
   */
  getAllInfo(): FilterInfo[] {
    return Array.from(this.filters.values()).map(r => r.info);
  }

  /**
   * Get filters by category
   */
  getByCategory(category: FilterCategory): FilterInfo[] {
    return this.getAllInfo().filter(info => info.category === category);
  }

  /**
   * Search filters by name, description, or tags
   */
  search(query: string): FilterInfo[] {
    const q = query.toLowerCase();
    return this.getAllInfo().filter(info =>
      info.displayName.toLowerCase().includes(q) ||
      info.description.toLowerCase().includes(q) ||
      info.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }

  /**
   * Create a new instance of a filter
   */
  create(id: string): AudioFilter {
    const registration = this.filters.get(id);
    if (!registration) {
      throw new Error(`Unknown filter: ${id}`);
    }
    return registration.factory();
  }

  /**
   * Check if a filter is registered
   */
  has(id: string): boolean {
    return this.filters.has(id);
  }

  /**
   * Get list of all filter IDs
   */
  getIds(): string[] {
    return Array.from(this.filters.keys());
  }

  /**
   * Get all categories that have at least one filter
   */
  getCategories(): FilterCategory[] {
    const categories = new Set<FilterCategory>();
    for (const { info } of this.filters.values()) {
      categories.add(info.category);
    }
    return Array.from(categories);
  }
}

/**
 * Global filter registry singleton
 */
export const FilterRegistry = new FilterRegistryImpl();

/**
 * Helper to create FilterInfo with defaults
 */
export function defineFilter(
  partial: Omit<FilterInfo, 'tags'> & { tags?: string[] }
): FilterInfo {
  return {
    ...partial,
    tags: partial.tags ?? [],
  };
}
