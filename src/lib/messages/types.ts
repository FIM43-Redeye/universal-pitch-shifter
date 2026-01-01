/**
 * Typed Message Protocol
 *
 * Replaces the untyped { command: string } pattern with discriminated unions.
 * Provides type safety for both requests and responses.
 */

import type { SerializablePipelineState, SiteMode } from '../storage/schema';
import type { FilterParameter } from '../../filters/base';
import type { FilterCategory } from '../../filters/registry';

// =============================================================================
// Filter Info (subset of FilterInfo for messaging)
// =============================================================================

/**
 * Information about an available filter.
 * Sent from content script to popup for the filter browser.
 */
export interface FilterInfoMessage {
  id: string;
  displayName: string;
  description: string;
  category: FilterCategory;
  tags: string[];
  parameters: FilterParameter[];
  requiresWasm: boolean;
  cpuUsage: 'low' | 'medium' | 'high';
}

/**
 * Information about an active filter instance.
 */
export interface ActiveFilterInfo {
  instanceId: string;
  typeId: string;
  displayName: string;
  enabled: boolean;
  parameters: Record<string, number | boolean>;
}

// =============================================================================
// Request Messages (Popup -> Content Script)
// =============================================================================

/**
 * All possible request messages.
 * Using discriminated union on 'type' field.
 */
export type RequestMessage =
  // Status & Info
  | { type: 'GET_STATUS' }
  | { type: 'GET_PIPELINE_STATE' }
  | { type: 'GET_AVAILABLE_FILTERS' }
  | { type: 'GET_FILTER_INFO'; filterTypeId: string }

  // Pipeline Manipulation
  | { type: 'ADD_FILTER'; filterTypeId: string; insertAt?: number }
  | { type: 'REMOVE_FILTER'; instanceId: string }
  | { type: 'MOVE_FILTER'; instanceId: string; toIndex: number }
  | { type: 'CLEAR_PIPELINE' }

  // Filter Control
  | { type: 'SET_FILTER_PARAMETER'; instanceId: string; paramName: string; value: number | boolean }
  | { type: 'SET_FILTER_ENABLED'; instanceId: string; enabled: boolean }
  | { type: 'RESET_FILTER'; instanceId: string }

  // Bulk Operations
  | { type: 'LOAD_PIPELINE'; pipeline: SerializablePipelineState }
  | { type: 'LOAD_PRESET'; presetId: string }

  // Site Mode
  | { type: 'GET_SITE_MODE' }
  | { type: 'SET_SITE_MODE'; mode: SiteMode; presetId?: string }

  // Utility
  | { type: 'CLEANUP' }

  // Easter eggs (keeping backward compatibility)
  | { type: 'VINESAUCE' }

  // Legacy support (for gradual migration)
  | LegacyMessage;

/**
 * Legacy message format for backward compatibility.
 * Will be removed after migration is complete.
 */
export interface LegacyMessage {
  type: 'LEGACY';
  command: string;
  [key: string]: unknown;
}

// =============================================================================
// Response Messages (Content Script -> Popup)
// =============================================================================

/**
 * Base success response.
 */
export interface SuccessResponse {
  success: true;
}

/**
 * Base error response.
 */
export interface ErrorResponse {
  success: false;
  error: string;
}

/**
 * Response for GET_STATUS.
 */
export interface StatusResponse extends SuccessResponse {
  mediaCount: number;
  connectedCount: number;
  pipelineActive: boolean;
  hostname: string;
  siteMode: SiteMode | 'none';
  engineInfo: string;
}

/**
 * Response for GET_PIPELINE_STATE.
 */
export interface PipelineStateResponse extends SuccessResponse {
  pipeline: SerializablePipelineState;
  filters: ActiveFilterInfo[];
}

/**
 * Response for GET_AVAILABLE_FILTERS.
 */
export interface AvailableFiltersResponse extends SuccessResponse {
  filters: FilterInfoMessage[];
  categories: Array<{ id: FilterCategory; label: string; count: number }>;
}

/**
 * Response for GET_FILTER_INFO.
 */
export interface FilterInfoResponse extends SuccessResponse {
  filter: FilterInfoMessage;
}

/**
 * Response for ADD_FILTER.
 */
export interface AddFilterResponse extends SuccessResponse {
  instanceId: string;
  filter: ActiveFilterInfo;
}

/**
 * Response for MOVE_FILTER.
 */
export interface MoveFilterResponse extends SuccessResponse {
  newIndex: number;
}

/**
 * Response for GET_SITE_MODE.
 */
export interface SiteModeResponse extends SuccessResponse {
  mode: SiteMode | 'none';
  hostname: string;
  presetId?: string;
}

/**
 * Response for VINESAUCE easter egg.
 */
export interface VinesauceResponse extends SuccessResponse {
  vinesauceMode: boolean;
  message: string;
}

/**
 * Response for CLEANUP.
 */
export interface CleanupResponse extends SuccessResponse {
  cleaned: number;
  remaining: number;
  message: string;
}

/**
 * Map request types to their response types.
 * Used for type inference in the handler.
 */
export type ResponseFor<T extends RequestMessage['type']> =
  T extends 'GET_STATUS' ? StatusResponse :
  T extends 'GET_PIPELINE_STATE' ? PipelineStateResponse :
  T extends 'GET_AVAILABLE_FILTERS' ? AvailableFiltersResponse :
  T extends 'GET_FILTER_INFO' ? FilterInfoResponse :
  T extends 'ADD_FILTER' ? AddFilterResponse :
  T extends 'REMOVE_FILTER' ? SuccessResponse :
  T extends 'MOVE_FILTER' ? MoveFilterResponse :
  T extends 'CLEAR_PIPELINE' ? SuccessResponse :
  T extends 'SET_FILTER_PARAMETER' ? SuccessResponse :
  T extends 'SET_FILTER_ENABLED' ? SuccessResponse :
  T extends 'RESET_FILTER' ? SuccessResponse :
  T extends 'LOAD_PIPELINE' ? SuccessResponse :
  T extends 'LOAD_PRESET' ? SuccessResponse :
  T extends 'GET_SITE_MODE' ? SiteModeResponse :
  T extends 'SET_SITE_MODE' ? SuccessResponse :
  T extends 'CLEANUP' ? CleanupResponse :
  T extends 'VINESAUCE' ? VinesauceResponse :
  T extends 'LEGACY' ? unknown :
  SuccessResponse | ErrorResponse;

// =============================================================================
// Message Type Guards
// =============================================================================

/**
 * Check if a message uses the new typed format.
 */
export function isTypedMessage(message: unknown): message is RequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof (message as RequestMessage).type === 'string'
  );
}

/**
 * Check if a message is a legacy format message.
 */
export function isLegacyMessage(message: unknown): message is { command: string; [key: string]: unknown } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'command' in message &&
    typeof (message as { command: string }).command === 'string' &&
    !('type' in message)
  );
}

/**
 * Convert legacy message to typed format.
 * Provides backward compatibility during migration.
 */
export function convertLegacyMessage(legacy: { command: string; [key: string]: unknown }): RequestMessage {
  switch (legacy.command) {
    case 'get-status':
      return { type: 'GET_STATUS' };

    case 'get-filters':
      return { type: 'GET_PIPELINE_STATE' };

    case 'add-filter':
      return { type: 'ADD_FILTER', filterTypeId: legacy.filterType as string };

    case 'remove-filter':
      return { type: 'REMOVE_FILTER', instanceId: legacy.filterId as string };

    case 'set-params':
      // Legacy set-params was for pitch filter only
      // Convert to individual parameter sets (handled specially in content script)
      return { type: 'LEGACY', command: legacy.command } as LegacyMessage;

    case 'reset':
      return { type: 'CLEAR_PIPELINE' };

    case 'cleanup':
      return { type: 'CLEANUP' };

    case 'vinesauce':
      return { type: 'VINESAUCE' };

    default:
      return { type: 'LEGACY', command: legacy.command } as LegacyMessage;
  }
}

// =============================================================================
// Category Labels
// =============================================================================

/**
 * Human-readable labels for filter categories.
 */
export const CATEGORY_LABELS: Record<FilterCategory, string> = {
  pitch: 'Pitch & Tempo',
  eq: 'Equalization',
  dynamics: 'Dynamics',
  time: 'Time & Space',
  modulation: 'Modulation',
  utility: 'Utility',
  ffmpeg: 'FFmpeg Filters',
};
