/**
 * Storage Module
 *
 * Exports the storage manager and schema types.
 */

export { storage, StorageManager } from './storage';

export type {
  SerializableFilterState,
  SerializablePipelineState,
  Preset,
  PresetExport,
  SiteConfig,
  SiteMode,
  GlobalSettings,
  UISettings,
  SessionCacheEntry,
  SyncStorage,
  LocalStorage,
} from './schema';

export {
  DEFAULT_SETTINGS,
  DEFAULT_SYNC_STORAGE,
  DEFAULT_LOCAL_STORAGE,
  STORAGE_VERSION,
} from './schema';
