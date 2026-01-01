/**
 * Message Handler
 *
 * Type-safe message routing for content script.
 * Replaces the switch-case on string commands.
 */

import type {
  RequestMessage,
  SuccessResponse,
  ErrorResponse,
  StatusResponse,
  PipelineStateResponse,
  AvailableFiltersResponse,
  FilterInfoResponse,
  AddFilterResponse,
  MoveFilterResponse,
  SiteModeResponse,
  VinesauceResponse,
  CleanupResponse,
  SavePresetResponse,
  PipelineForPresetResponse,
  ActiveFilterInfo,
  FilterInfoMessage,
} from './types';
import { isTypedMessage, isLegacyMessage, convertLegacyMessage, CATEGORY_LABELS } from './types';
import type { FilterPipeline } from '../../filters/pipeline';
import type { AudioFilter } from '../../filters/base';
import type { FilterCategory } from '../../filters/registry';
import type { SerializablePipelineState, SiteMode } from '../storage/schema';
import { presets } from '../presets/preset-manager';

// =============================================================================
// Handler Context
// =============================================================================

/**
 * Context provided to message handlers.
 * Contains all the state and utilities needed to handle messages.
 */
export interface MessageContext {
  /** The filter pipeline for the current media element */
  pipeline: FilterPipeline | null;

  /** Map of active filter instances by instance ID */
  filters: Map<string, { id: string; filter: AudioFilter }>;

  /** Function to get/create pipeline for the connected media */
  getPipeline(): FilterPipeline | null;

  /** Function to add a filter by type ID */
  addFilter(typeId: string, insertAt?: number): Promise<{ instanceId: string; filter: AudioFilter }>;

  /** Function to remove a filter by instance ID */
  removeFilter(instanceId: string): Promise<boolean>;

  /** Current hostname */
  hostname: string;

  /** Current site mode */
  siteMode: SiteMode | 'none';

  /** Number of media elements found */
  mediaCount: number;

  /** Number of connected media elements */
  connectedCount: number;

  /** Current vinesauce mode state */
  vinesauceMode: boolean;

  /** Toggle vinesauce mode */
  toggleVinesauce(): boolean;

  /** Cleanup removed elements */
  cleanup(): { cleaned: number; remaining: number };

  /** Get available filter info from registry */
  getAvailableFilters(): FilterInfoMessage[];

  /** Get filter info by ID */
  getFilterInfo(typeId: string): FilterInfoMessage | null;

  /** Move filter in pipeline */
  moveFilter(instanceId: string, toIndex: number): Promise<void>;
}

// =============================================================================
// Response type for handlers
// =============================================================================

type AnyResponse =
  | SuccessResponse
  | ErrorResponse
  | StatusResponse
  | PipelineStateResponse
  | AvailableFiltersResponse
  | FilterInfoResponse
  | AddFilterResponse
  | MoveFilterResponse
  | SiteModeResponse
  | VinesauceResponse
  | CleanupResponse
  | SavePresetResponse
  | PipelineForPresetResponse;

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Route a message to the appropriate handler.
 * Supports both new typed messages and legacy format.
 */
export async function handleMessage(
  rawMessage: unknown,
  context: MessageContext
): Promise<AnyResponse> {
  // Convert legacy messages
  let message: RequestMessage;

  if (isTypedMessage(rawMessage)) {
    message = rawMessage;
  } else if (isLegacyMessage(rawMessage)) {
    message = convertLegacyMessage(rawMessage);
  } else {
    return { success: false, error: 'Invalid message format' };
  }

  // Route to handler
  try {
    switch (message.type) {
      case 'GET_STATUS':
        return {
          success: true,
          mediaCount: context.mediaCount,
          connectedCount: context.connectedCount,
          pipelineActive: context.pipeline !== null && context.pipeline.chain.length > 0,
          hostname: context.hostname,
          siteMode: context.siteMode,
          engineInfo: 'SoundTouch',
        } as StatusResponse;

      case 'GET_PIPELINE_STATE': {
        const filters: ActiveFilterInfo[] = [];
        for (const [instanceId, { filter }] of context.filters) {
          const params: Record<string, number | boolean> = {};
          for (const p of filter.parameters) {
            params[p.name] = p.value;
          }
          filters.push({
            instanceId,
            typeId: filter.name,
            displayName: filter.displayName,
            enabled: !filter.bypassed,
            parameters: params,
          });
        }
        return {
          success: true,
          pipeline: {
            filters: filters.map(f => ({
              typeId: f.typeId,
              instanceId: f.instanceId,
              enabled: f.enabled,
              parameters: f.parameters,
            })),
          },
          filters,
        } as PipelineStateResponse;
      }

      case 'GET_AVAILABLE_FILTERS': {
        const filters = context.getAvailableFilters();
        const categoryCounts = new Map<FilterCategory, number>();
        for (const f of filters) {
          categoryCounts.set(f.category, (categoryCounts.get(f.category) ?? 0) + 1);
        }
        const categories = Array.from(categoryCounts.entries()).map(([id, count]) => ({
          id,
          label: CATEGORY_LABELS[id],
          count,
        }));
        return { success: true, filters, categories } as AvailableFiltersResponse;
      }

      case 'GET_FILTER_INFO': {
        const filter = context.getFilterInfo(message.filterTypeId);
        if (!filter) {
          return { success: false, error: `Unknown filter type: ${message.filterTypeId}` };
        }
        return { success: true, filter } as FilterInfoResponse;
      }

      case 'ADD_FILTER': {
        try {
          const { instanceId, filter } = await context.addFilter(message.filterTypeId, message.insertAt);
          const params: Record<string, number | boolean> = {};
          for (const p of filter.parameters) {
            params[p.name] = p.value;
          }
          return {
            success: true,
            instanceId,
            filter: {
              instanceId,
              typeId: filter.name,
              displayName: filter.displayName,
              enabled: !filter.bypassed,
              parameters: params,
            },
          } as AddFilterResponse;
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }

      case 'REMOVE_FILTER': {
        const removed = await context.removeFilter(message.instanceId);
        if (!removed) {
          return { success: false, error: `Filter not found: ${message.instanceId}` };
        }
        return { success: true };
      }

      case 'MOVE_FILTER': {
        try {
          await context.moveFilter(message.instanceId, message.toIndex);
          return { success: true, newIndex: message.toIndex } as MoveFilterResponse;
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }

      case 'CLEAR_PIPELINE': {
        if (!context.pipeline) {
          return { success: false, error: 'No active pipeline' };
        }
        for (const [instanceId] of context.filters) {
          await context.removeFilter(instanceId);
        }
        return { success: true };
      }

      case 'SET_FILTER_PARAMETER': {
        const tracked = context.filters.get(message.instanceId);
        if (!tracked) {
          return { success: false, error: `Filter not found: ${message.instanceId}` };
        }
        try {
          tracked.filter.setParameter(message.paramName, message.value);
          return { success: true };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }

      case 'SET_FILTER_ENABLED': {
        const tracked = context.filters.get(message.instanceId);
        if (!tracked) {
          return { success: false, error: `Filter not found: ${message.instanceId}` };
        }
        tracked.filter.bypassed = !message.enabled;
        return { success: true };
      }

      case 'RESET_FILTER': {
        const tracked = context.filters.get(message.instanceId);
        if (!tracked) {
          return { success: false, error: `Filter not found: ${message.instanceId}` };
        }
        tracked.filter.resetParameters();
        return { success: true };
      }

      case 'LOAD_PIPELINE': {
        try {
          // Clear existing filters
          for (const [instanceId] of context.filters) {
            await context.removeFilter(instanceId);
          }
          // Add filters from the saved state
          for (const filterState of message.pipeline.filters) {
            const { filter } = await context.addFilter(filterState.typeId);
            for (const [name, value] of Object.entries(filterState.parameters)) {
              filter.setParameter(name, value);
            }
            filter.bypassed = !filterState.enabled;
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }

      case 'LOAD_PRESET': {
        try {
          const preset = await presets.getById(message.presetId);
          if (!preset) {
            return { success: false, error: `Preset not found: ${message.presetId}` };
          }
          // Clear existing filters
          for (const [instanceId] of context.filters) {
            await context.removeFilter(instanceId);
          }
          // Add filters from the preset
          for (const filterState of preset.pipeline.filters) {
            const { filter } = await context.addFilter(filterState.typeId);
            for (const [name, value] of Object.entries(filterState.parameters)) {
              filter.setParameter(name, value);
            }
            filter.bypassed = !filterState.enabled;
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }

      case 'SAVE_PRESET': {
        try {
          // Get current pipeline state from context
          const filters: Array<{
            typeId: string;
            instanceId: string;
            enabled: boolean;
            parameters: Record<string, number | boolean>;
          }> = [];
          for (const [instanceId, { filter }] of context.filters) {
            const params: Record<string, number | boolean> = {};
            for (const p of filter.parameters) {
              params[p.name] = p.value;
            }
            filters.push({
              typeId: filter.name,
              instanceId,
              enabled: !filter.bypassed,
              parameters: params,
            });
          }

          const preset = await presets.createFromState(
            { filters },
            {
              name: message.name,
              description: message.description,
              tags: message.tags,
            }
          );
          return { success: true, preset } as SavePresetResponse;
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }

      case 'GET_PIPELINE_FOR_PRESET': {
        const filters: Array<{
          typeId: string;
          instanceId: string;
          enabled: boolean;
          parameters: Record<string, number | boolean>;
        }> = [];
        for (const [instanceId, { filter }] of context.filters) {
          const params: Record<string, number | boolean> = {};
          for (const p of filter.parameters) {
            params[p.name] = p.value;
          }
          filters.push({
            typeId: filter.name,
            instanceId,
            enabled: !filter.bypassed,
            parameters: params,
          });
        }
        return { success: true, pipeline: { filters } } as PipelineForPresetResponse;
      }

      case 'GET_SITE_MODE':
        return {
          success: true,
          mode: context.siteMode,
          hostname: context.hostname,
        } as SiteModeResponse;

      case 'SET_SITE_MODE':
        // TODO: Implement when integrated with StorageManager
        return { success: true };

      case 'CLEANUP': {
        const { cleaned, remaining } = context.cleanup();
        return {
          success: true,
          cleaned,
          remaining,
          message: `Cleaned up ${cleaned} removed elements. ${remaining} remain.`,
        } as CleanupResponse;
      }

      case 'VINESAUCE': {
        const vinesauceMode = context.toggleVinesauce();
        return {
          success: true,
          vinesauceMode,
          message: vinesauceMode ? 'Blame Gray Leno for this' : 'Normal mode restored',
        } as VinesauceResponse;
      }

      case 'TOGGLE_BYPASS': {
        // Toggle bypass on all filters
        // Logic: if any filter is active (not bypassed), bypass all
        // If all are bypassed, un-bypass all
        const filters = Array.from(context.filters.values());
        if (filters.length === 0) {
          return { success: true };
        }

        const anyActive = filters.some(({ filter }) => !filter.bypassed);
        const newBypassState = anyActive; // If any active, bypass all

        for (const { filter } of filters) {
          filter.bypassed = newBypassState;
        }

        return { success: true };
      }

      case 'LEGACY':
        return { success: false, error: `Unsupported legacy command: ${message.command}` };

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = message;
        return { success: false, error: `Unknown message type` };
      }
    }
  } catch (error) {
    console.error('[UPS] Message handler error:', error);
    return { success: false, error: String(error) };
  }
}
