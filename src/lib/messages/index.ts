/**
 * Messages Module
 *
 * Typed message protocol for popup/content script communication.
 */

export { handleMessage } from './handler';
export type { MessageContext } from './handler';

export type {
  RequestMessage,
  ResponseFor,
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
  LegacyMessage,
} from './types';

export {
  isTypedMessage,
  isLegacyMessage,
  convertLegacyMessage,
  CATEGORY_LABELS,
} from './types';
