/**
 * Preset Manager
 *
 * Handles saving, loading, and sharing filter chain presets.
 * Works with the StorageManager for persistence.
 */

import { storage } from '../storage';
import type { Preset, PresetExport, SerializablePipelineState } from '../storage/schema';
import type { FilterPipeline } from '../../filters/pipeline';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of an import operation.
 */
export interface ImportResult {
  imported: Preset[];
  errors: Array<{ name: string; error: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Options for creating a preset.
 */
export interface CreatePresetOptions {
  name: string;
  description?: string;
  tags?: string[];
}

// =============================================================================
// Preset Manager
// =============================================================================

/**
 * Manages preset operations: create, load, export, import.
 *
 * Presets are saved filter chains that can be loaded into any pipeline.
 * They're stored in chrome.storage.sync for cross-device availability.
 */
export class PresetManager {
  /**
   * Generate a unique preset ID.
   */
  private generateId(): string {
    return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Create a preset from the current pipeline state.
   *
   * @param pipeline - The pipeline to save
   * @param options - Name, description, and tags for the preset
   * @returns The created preset
   */
  async createFromPipeline(
    pipeline: FilterPipeline,
    options: CreatePresetOptions
  ): Promise<Preset> {
    const now = Date.now();
    const preset: Preset = {
      id: this.generateId(),
      name: options.name.trim(),
      description: options.description?.trim(),
      createdAt: now,
      modifiedAt: now,
      pipeline: pipeline.getSerializableState(),
      tags: options.tags?.map(t => t.trim().toLowerCase()),
    };

    await storage.savePreset(preset);
    return preset;
  }

  /**
   * Create a preset from raw pipeline state (not a live pipeline).
   *
   * Useful for importing or duplicating presets.
   */
  async createFromState(
    state: SerializablePipelineState,
    options: CreatePresetOptions
  ): Promise<Preset> {
    const now = Date.now();
    const preset: Preset = {
      id: this.generateId(),
      name: options.name.trim(),
      description: options.description?.trim(),
      createdAt: now,
      modifiedAt: now,
      pipeline: state,
      tags: options.tags?.map(t => t.trim().toLowerCase()),
    };

    await storage.savePreset(preset);
    return preset;
  }

  /**
   * Load a preset into a pipeline.
   *
   * @param presetId - The preset ID to load
   * @param pipeline - The pipeline to load into (must be initialized)
   */
  async loadInto(presetId: string, pipeline: FilterPipeline): Promise<void> {
    const presets = await storage.getPresets();
    const preset = presets.find(p => p.id === presetId);

    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    await pipeline.loadFromState(preset.pipeline);
  }

  /**
   * Load a preset by name (case-insensitive).
   *
   * @param name - The preset name to find
   * @param pipeline - The pipeline to load into
   */
  async loadByName(name: string, pipeline: FilterPipeline): Promise<void> {
    const presets = await storage.getPresets();
    const normalizedName = name.trim().toLowerCase();
    const preset = presets.find(p => p.name.toLowerCase() === normalizedName);

    if (!preset) {
      throw new Error(`Preset not found: ${name}`);
    }

    await pipeline.loadFromState(preset.pipeline);
  }

  /**
   * Get all presets.
   */
  async getAll(): Promise<Preset[]> {
    return storage.getPresets();
  }

  /**
   * Get a preset by ID.
   */
  async getById(presetId: string): Promise<Preset | undefined> {
    const presets = await storage.getPresets();
    return presets.find(p => p.id === presetId);
  }

  /**
   * Get presets by tag.
   */
  async getByTag(tag: string): Promise<Preset[]> {
    const presets = await storage.getPresets();
    const normalizedTag = tag.trim().toLowerCase();
    return presets.filter(p => p.tags?.includes(normalizedTag));
  }

  /**
   * Update an existing preset's metadata.
   *
   * Does not update the pipeline state - use updatePipeline for that.
   */
  async updateMetadata(
    presetId: string,
    updates: Partial<Pick<Preset, 'name' | 'description' | 'tags'>>
  ): Promise<Preset> {
    const presets = await storage.getPresets();
    const preset = presets.find(p => p.id === presetId);

    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    if (preset.isFactory) {
      throw new Error('Cannot modify factory presets');
    }

    const updated: Preset = {
      ...preset,
      name: updates.name?.trim() ?? preset.name,
      description: updates.description?.trim() ?? preset.description,
      tags: updates.tags?.map(t => t.trim().toLowerCase()) ?? preset.tags,
      modifiedAt: Date.now(),
    };

    await storage.savePreset(updated);
    return updated;
  }

  /**
   * Update a preset's pipeline state from a live pipeline.
   */
  async updatePipeline(presetId: string, pipeline: FilterPipeline): Promise<Preset> {
    const presets = await storage.getPresets();
    const preset = presets.find(p => p.id === presetId);

    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    if (preset.isFactory) {
      throw new Error('Cannot modify factory presets');
    }

    const updated: Preset = {
      ...preset,
      pipeline: pipeline.getSerializableState(),
      modifiedAt: Date.now(),
    };

    await storage.savePreset(updated);
    return updated;
  }

  /**
   * Duplicate a preset with a new name.
   */
  async duplicate(presetId: string, newName: string): Promise<Preset> {
    const presets = await storage.getPresets();
    const original = presets.find(p => p.id === presetId);

    if (!original) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    const now = Date.now();
    const duplicate: Preset = {
      id: this.generateId(),
      name: newName.trim(),
      description: original.description,
      createdAt: now,
      modifiedAt: now,
      pipeline: JSON.parse(JSON.stringify(original.pipeline)), // Deep copy
      tags: original.tags ? [...original.tags] : undefined,
      // Note: isFactory is NOT copied - duplicates are user presets
    };

    await storage.savePreset(duplicate);
    return duplicate;
  }

  /**
   * Delete a preset.
   *
   * @returns true if deleted, false if not found
   */
  async delete(presetId: string): Promise<boolean> {
    const presets = await storage.getPresets();
    const preset = presets.find(p => p.id === presetId);

    if (!preset) {
      return false;
    }

    if (preset.isFactory) {
      throw new Error('Cannot delete factory presets');
    }

    await storage.deletePreset(presetId);
    return true;
  }

  // ===========================================================================
  // Export / Import
  // ===========================================================================

  /**
   * Export all user presets as a JSON string.
   *
   * Factory presets are excluded from export.
   */
  async exportAll(): Promise<string> {
    const presets = await storage.getPresets();
    const userPresets = presets.filter(p => !p.isFactory);

    const exportData: PresetExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'universal-audio-filter',
      presets: userPresets,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export specific presets by ID.
   */
  async exportSelected(presetIds: string[]): Promise<string> {
    const presets = await storage.getPresets();
    const selected = presets.filter(p => presetIds.includes(p.id) && !p.isFactory);

    const exportData: PresetExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'universal-audio-filter',
      presets: selected,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import presets from a JSON string.
   *
   * Handles duplicates by appending a number to the name.
   */
  async importFromJson(json: string): Promise<ImportResult> {
    const result: ImportResult = {
      imported: [],
      errors: [],
      skipped: [],
    };

    // Parse the JSON - treat as unknown since we're dealing with untrusted input
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      result.errors.push({ name: '(parse error)', error: 'Invalid JSON format' });
      return result;
    }

    // Validate structure
    if (!parsed || typeof parsed !== 'object') {
      result.errors.push({ name: '(validation)', error: 'Invalid export format' });
      return result;
    }

    const exportData = parsed as Record<string, unknown>;
    if (!Array.isArray(exportData.presets)) {
      result.errors.push({ name: '(validation)', error: 'Missing presets array' });
      return result;
    }

    // Get existing presets for name collision detection
    const existingPresets = await storage.getPresets();
    const existingNames = new Set(existingPresets.map(p => p.name.toLowerCase()));

    // Import each preset - presets array contains unknown items
    for (const presetData of exportData.presets as unknown[]) {
      try {
        // Validate preset structure
        if (!this.isValidPresetStructure(presetData)) {
          const maybePreset = presetData as Record<string, unknown> | null;
          result.errors.push({
            name: (maybePreset?.name as string) || '(unknown)',
            error: 'Invalid preset structure',
          });
          continue;
        }

        // Generate unique name if collision
        let name = presetData.name.trim();
        let counter = 1;
        while (existingNames.has(name.toLowerCase())) {
          name = `${presetData.name.trim()} (${counter})`;
          counter++;
        }

        // Create new preset with fresh ID
        const now = Date.now();
        const imported: Preset = {
          id: this.generateId(),
          name,
          description: presetData.description,
          createdAt: now,
          modifiedAt: now,
          pipeline: presetData.pipeline,
          tags: presetData.tags,
          // Note: isFactory is NOT imported - all imports are user presets
        };

        await storage.savePreset(imported);
        existingNames.add(name.toLowerCase());
        result.imported.push(imported);
      } catch (error) {
        // presetData is typed as unknown at this point, so access name safely
        const presetName = (presetData as Record<string, unknown> | null)?.name;
        result.errors.push({
          name: (typeof presetName === 'string' ? presetName : null) || '(unknown)',
          error: String(error),
        });
      }
    }

    return result;
  }

  /**
   * Validate that an object has the required preset structure.
   */
  private isValidPresetStructure(obj: unknown): obj is Preset {
    if (!obj || typeof obj !== 'object') return false;

    const preset = obj as Record<string, unknown>;

    // Required fields
    if (typeof preset.name !== 'string' || !preset.name.trim()) return false;
    if (!preset.pipeline || typeof preset.pipeline !== 'object') return false;

    // Validate pipeline structure
    const pipeline = preset.pipeline as Record<string, unknown>;
    if (!Array.isArray(pipeline.filters)) return false;

    // Validate each filter in the pipeline
    for (const filter of pipeline.filters) {
      if (!filter || typeof filter !== 'object') return false;
      const f = filter as Record<string, unknown>;
      if (typeof f.typeId !== 'string') return false;
      if (typeof f.enabled !== 'boolean') return false;
      if (!f.parameters || typeof f.parameters !== 'object') return false;
    }

    return true;
  }

  // ===========================================================================
  // Factory Presets
  // ===========================================================================

  /**
   * Install factory presets if they don't exist.
   *
   * Call this during extension initialization.
   */
  async installFactoryPresets(): Promise<void> {
    const existing = await storage.getPresets();
    const existingIds = new Set(existing.map(p => p.id));

    for (const factory of FACTORY_PRESETS) {
      if (!existingIds.has(factory.id)) {
        await storage.savePreset(factory);
      }
    }
  }
}

// =============================================================================
// Factory Presets
// =============================================================================

/**
 * Built-in presets that ship with the extension.
 *
 * These provide starting points and demonstrate filter combinations.
 * Users can duplicate but not modify or delete them.
 */
const FACTORY_PRESETS: Preset[] = [
  {
    id: 'factory-voice-enhancement',
    name: 'Voice Enhancement',
    description: 'Clearer vocals with subtle compression and presence boost',
    createdAt: 0,
    modifiedAt: 0,
    isFactory: true,
    tags: ['voice', 'podcast', 'clarity'],
    pipeline: {
      filters: [
        {
          typeId: 'parametric-eq',
          instanceId: 'factory-eq-1',
          enabled: true,
          parameters: {
            lowGain: -2,      // Reduce rumble
            midGain: 0,
            highGain: 3,      // Add presence
            lowFreq: 100,
            midFreq: 1000,
            highFreq: 4000,
            lowQ: 0.7,
            midQ: 1.0,
            highQ: 0.7,
          },
        },
        {
          typeId: 'compressor',
          instanceId: 'factory-comp-1',
          enabled: true,
          parameters: {
            threshold: -24,
            ratio: 3,
            attack: 10,
            release: 100,
            knee: 6,
            makeupGain: 3,
          },
        },
      ],
    },
  },
  {
    id: 'factory-music-warmth',
    name: 'Warm Music',
    description: 'Adds warmth and fullness to music playback',
    createdAt: 0,
    modifiedAt: 0,
    isFactory: true,
    tags: ['music', 'warm', 'bass'],
    pipeline: {
      filters: [
        {
          typeId: 'parametric-eq',
          instanceId: 'factory-eq-2',
          enabled: true,
          parameters: {
            lowGain: 4,       // Bass boost
            midGain: -1,      // Slight mid scoop
            highGain: 1,      // Gentle highs
            lowFreq: 80,
            midFreq: 800,
            highFreq: 8000,
            lowQ: 0.5,
            midQ: 0.8,
            highQ: 0.5,
          },
        },
      ],
    },
  },
  {
    id: 'factory-pitch-down-octave',
    name: 'Down One Octave',
    description: 'Shifts pitch down by one octave (12 semitones)',
    createdAt: 0,
    modifiedAt: 0,
    isFactory: true,
    tags: ['pitch', 'octave', 'deep'],
    pipeline: {
      filters: [
        {
          typeId: 'soundtouch',
          instanceId: 'factory-pitch-1',
          enabled: true,
          parameters: {
            pitch: -12,
            tempo: 0,
          },
        },
      ],
    },
  },
  {
    id: 'factory-chipmunk',
    name: 'Chipmunk Mode',
    description: 'High-pitched voice effect',
    createdAt: 0,
    modifiedAt: 0,
    isFactory: true,
    tags: ['pitch', 'fun', 'voice'],
    pipeline: {
      filters: [
        {
          typeId: 'soundtouch',
          instanceId: 'factory-pitch-2',
          enabled: true,
          parameters: {
            pitch: 8,
            tempo: 0,
          },
        },
      ],
    },
  },
];

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton preset manager instance.
 */
export const presets = new PresetManager();
