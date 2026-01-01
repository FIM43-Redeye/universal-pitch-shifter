/**
 * Filter Pipeline
 *
 * Manages a chain of audio filters, handling connections and routing.
 * Filters can be added, removed, reordered, and bypassed without
 * interrupting audio playback.
 */

import { AudioFilter, FilterState } from "./base";
import { FilterRegistry } from "./registry";
import type { SerializablePipelineState, SerializableFilterState } from "../lib/storage/schema";

/**
 * Serializable pipeline state for persistence.
 */
export interface PipelineState {
  filters: FilterState[];
}

/**
 * Manages a chain of audio filters.
 *
 * The pipeline connects filters in series:
 * input -> filter1 -> filter2 -> ... -> filterN -> output
 *
 * When filters are added/removed/reordered, the pipeline
 * reconnects the audio graph automatically.
 */
export class FilterPipeline {
  private context: AudioContext | null = null;
  private filters: AudioFilter[] = [];

  // Input/output nodes for connecting to external audio graph
  private _inputNode: GainNode | null = null;
  private _outputNode: GainNode | null = null;

  /**
   * The node to connect audio sources to.
   */
  get inputNode(): AudioNode {
    if (!this._inputNode) {
      throw new Error("Pipeline not initialized");
    }
    return this._inputNode;
  }

  /**
   * The node to connect to audio destination.
   */
  get outputNode(): AudioNode {
    if (!this._outputNode) {
      throw new Error("Pipeline not initialized");
    }
    return this._outputNode;
  }

  /**
   * Current filter chain (read-only view).
   */
  get chain(): readonly AudioFilter[] {
    return this.filters;
  }

  /**
   * Initialize the pipeline with an audio context.
   */
  async initialize(context: AudioContext): Promise<void> {
    this.context = context;

    // Create input/output gain nodes
    this._inputNode = context.createGain();
    this._outputNode = context.createGain();

    // Initialize all filters
    for (const filter of this.filters) {
      await filter.initialize(context);
    }

    // Build the connection chain
    this.rebuildConnections();
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    for (const filter of this.filters) {
      filter.dispose();
    }
    this.filters = [];
    this._inputNode?.disconnect();
    this._outputNode?.disconnect();
    this._inputNode = null;
    this._outputNode = null;
    this.context = null;
  }

  /**
   * Add a filter to the end of the chain.
   */
  async addFilter(filter: AudioFilter): Promise<void> {
    if (this.context) {
      await filter.initialize(this.context);
    }
    this.filters.push(filter);
    this.rebuildConnections();
  }

  /**
   * Insert a filter at a specific position.
   */
  async insertFilter(filter: AudioFilter, index: number): Promise<void> {
    if (this.context) {
      await filter.initialize(this.context);
    }
    this.filters.splice(index, 0, filter);
    this.rebuildConnections();
  }

  /**
   * Remove a filter by reference.
   */
  removeFilter(filter: AudioFilter): void {
    const index = this.filters.indexOf(filter);
    if (index !== -1) {
      this.filters.splice(index, 1);
      filter.dispose();
      this.rebuildConnections();
    }
  }

  /**
   * Remove a filter by index.
   */
  removeFilterAt(index: number): void {
    if (index >= 0 && index < this.filters.length) {
      const filter = this.filters.splice(index, 1)[0];
      filter.dispose();
      this.rebuildConnections();
    }
  }

  /**
   * Move a filter to a new position.
   */
  moveFilter(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.filters.length) return;
    if (toIndex < 0 || toIndex >= this.filters.length) return;

    const [filter] = this.filters.splice(fromIndex, 1);
    this.filters.splice(toIndex, 0, filter);
    this.rebuildConnections();
  }

  /**
   * Get a filter by name.
   */
  getFilter(name: string): AudioFilter | undefined {
    return this.filters.find(f => f.name === name);
  }

  /**
   * Get a filter by index.
   */
  getFilterAt(index: number): AudioFilter | undefined {
    return this.filters[index];
  }

  /**
   * Get complete pipeline state for serialization.
   */
  getState(): PipelineState {
    return {
      filters: this.filters.map(f => f.getState()),
    };
  }

  /**
   * Restore pipeline state.
   * Note: Filters must already exist in the pipeline; this only restores parameters.
   */
  setState(state: PipelineState): void {
    for (const filterState of state.filters) {
      const filter = this.getFilter(filterState.name);
      if (filter) {
        filter.setState(filterState);
      }
    }
  }

  // ===========================================================================
  // Enhanced State Management (for preset/storage integration)
  // ===========================================================================

  /**
   * Clear all filters from the pipeline.
   */
  async clear(): Promise<void> {
    // Dispose all filters
    for (const filter of this.filters) {
      filter.dispose();
    }
    this.filters = [];
    this.rebuildConnections();
  }

  /**
   * Get pipeline state with filter type IDs for storage/presets.
   * Unlike getState(), this includes the type ID needed to reconstruct filters.
   */
  getSerializableState(): SerializablePipelineState {
    return {
      filters: this.filters.map((filter, index) => ({
        typeId: filter.name,  // The filter's name is its type ID in the registry
        instanceId: `${filter.name}-${index}-${Date.now()}`,
        enabled: !filter.bypassed,
        parameters: Object.fromEntries(
          filter.parameters.map(p => [p.name, p.value])
        ),
      })),
    };
  }

  /**
   * Reconstruct pipeline from saved state.
   * Creates new filter instances from the registry and restores their parameters.
   *
   * @param state - The saved pipeline state
   * @param instanceIdMap - Optional map to store generated instance IDs (key: original instanceId)
   */
  async loadFromState(
    state: SerializablePipelineState,
    instanceIdMap?: Map<string, string>
  ): Promise<void> {
    if (!this.context) {
      throw new Error("Pipeline not initialized - call initialize() first");
    }

    // Clear existing filters
    await this.clear();

    // Recreate filters from state
    for (const filterState of state.filters) {
      // Look up the filter type in the registry
      const filterInfo = FilterRegistry.getInfo(filterState.typeId);
      if (!filterInfo) {
        console.warn(`[Pipeline] Unknown filter type: ${filterState.typeId}, skipping`);
        continue;
      }

      // Create a new instance
      const filter = FilterRegistry.create(filterState.typeId);
      if (!filter) {
        console.warn(`[Pipeline] Failed to create filter: ${filterState.typeId}, skipping`);
        continue;
      }

      // Initialize and add to pipeline
      await filter.initialize(this.context);
      this.filters.push(filter);

      // Restore parameters
      for (const [paramName, value] of Object.entries(filterState.parameters)) {
        try {
          filter.setParameter(paramName, value);
        } catch (error) {
          console.warn(`[Pipeline] Failed to set parameter ${paramName} on ${filterState.typeId}:`, error);
        }
      }

      // Restore enabled/bypassed state
      filter.bypassed = !filterState.enabled;

      // Track instance ID mapping if provided
      if (instanceIdMap) {
        const newInstanceId = `${filter.name}-${this.filters.length}-${Date.now()}`;
        instanceIdMap.set(filterState.instanceId, newInstanceId);
      }
    }

    // Rebuild audio connections
    this.rebuildConnections();
  }

  /**
   * Rebuild audio connections after chain modification.
   * Disconnects everything and reconnects in order.
   */
  private rebuildConnections(): void {
    if (!this._inputNode || !this._outputNode) return;

    // Disconnect everything first
    this._inputNode.disconnect();
    for (const filter of this.filters) {
      try {
        filter.outputNode.disconnect();
      } catch {
        // May not be connected yet
      }
    }

    // If no filters, connect input directly to output
    if (this.filters.length === 0) {
      this._inputNode.connect(this._outputNode);
      return;
    }

    // Connect: input -> first filter
    this._inputNode.connect(this.filters[0].inputNode);

    // Connect filters in chain
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i].outputNode.connect(this.filters[i + 1].inputNode);
    }

    // Connect: last filter -> output
    this.filters[this.filters.length - 1].outputNode.connect(this._outputNode);
  }
}
