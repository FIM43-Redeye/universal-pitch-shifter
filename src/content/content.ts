/**
 * Content Script
 *
 * Injected into web pages to find and process audio/video elements.
 * Uses the filter pipeline to apply audio processing with hot-swappable filters.
 */

import {
  FilterPipeline,
  SoundTouchFilter,
  RubberbandFilter,
  ParametricEQFilter,
  CompressorFilter,
  DelayFilter,
  AudioFilter,
} from '../filters';

// Import filter registry - side effect registers all built-in filters
import '../filters/register-builtins';
import { FilterRegistry } from '../filters/registry';

// Import typed message handler
import { handleMessage as handleTypedMessage, type MessageContext } from '../lib/messages';
import type { FilterInfoMessage } from '../lib/messages/types';

// Extension base URL - provided by bridge script running in ISOLATED world
// This is needed to load worklet/WASM files since MAIN world can't access chrome.runtime
let extensionBaseUrl: string | null = null;

// Try to get URL from data attribute (set by bridge script)
// This handles cases where bridge runs before our event listener is set up
function checkDataAttribute(): void {
  if (!extensionBaseUrl && document.documentElement?.dataset.upsExtensionUrl) {
    extensionBaseUrl = document.documentElement.dataset.upsExtensionUrl;
    console.log('[UPS] Got extension URL from data attribute:', extensionBaseUrl);
  }
}

// Check immediately
checkDataAttribute();

// Also listen for event (handles cases where we're set up before bridge)
window.addEventListener('ups-extension-url', (event: Event) => {
  const customEvent = event as CustomEvent;
  extensionBaseUrl = customEvent.detail.baseUrl;
  console.log('[UPS] Received extension base URL via event:', extensionBaseUrl);
});

// Export getter for filters to use
(window as any).__ups_getExtensionUrl = (path: string): string => {
  // Check data attribute each time in case it wasn't available earlier
  checkDataAttribute();

  if (extensionBaseUrl) {
    return extensionBaseUrl + path;
  }
  // Fallback - won't work but at least we'll get a meaningful error
  console.warn('[UPS] Extension base URL not available, worklet loading will fail');
  return path;
};

// Prevent double-initialization
if ((window as any).__ups_initialized) {
  console.log("[UPS] Already initialized, skipping");
} else {
  (window as any).__ups_initialized = true;
  initContentScript();
}

interface MediaState {
  element: HTMLMediaElement;
  audioContext: AudioContext | null;
  sourceNode: MediaElementAudioSourceNode | null;
  pipeline: FilterPipeline | null;
  pitchFilter: AudioFilter | null;
  connected: boolean;
}

// Track all media elements we're managing
const mediaElements = new Map<HTMLMediaElement, MediaState>();

// Current settings (shared across all elements on page)
let currentSettings = {
  semitone: 0,
  cents: 0,
  formant: 1.0,
  enabled: true,
  engine: 'soundtouch' as 'soundtouch' | 'rubberband',
};

// Track initialization failures for fallback
let rubberbandFailed = false;

// Easter egg: Vinesauce Mode - plays both original and pitched audio simultaneously
// Creates a cursed chorus effect. Discovered as a bug, preserved as a feature.
let vinesauceMode = false;

function initContentScript(): void {
  console.log("[UPS] Content script initializing");

  // Function to scan for media elements
  // We DON'T hook document.createElement - YouTube detects that and returns 403s
  function scanForMedia(): void {
    const elements = document.querySelectorAll("video, audio");
    if (elements.length > 0) {
      console.log(`[UPS] Found ${elements.length} media elements`);
    }
    elements.forEach((el) => {
      registerMediaElement(el as HTMLMediaElement);
    });
  }

  // Watch DOM for dynamically added elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLMediaElement) {
          console.log(`[UPS] MutationObserver caught: ${node.tagName}`);
          registerMediaElement(node);
        } else if (node instanceof Element) {
          node.querySelectorAll("video, audio").forEach((el) => {
            registerMediaElement(el as HTMLMediaElement);
          });
        }
      }
    }
  });

  // Start observing as soon as documentElement exists
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } else {
    // Wait for documentElement
    const waitForDoc = setInterval(() => {
      if (document.documentElement) {
        clearInterval(waitForDoc);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    }, 10);
  }

  // Periodic scan - YouTube creates video after page scripts run
  // Keep scanning until we find media, then slow down
  let scanAttempts = 0;
  const maxScans = 30; // 30 seconds max
  const scanInterval = setInterval(() => {
    scanAttempts++;
    scanForMedia();

    if (mediaElements.size > 0) {
      // Found media - slow down scanning
      clearInterval(scanInterval);
      // Keep a slow poll for page navigation (SPA)
      setInterval(scanForMedia, 5000);
      console.log("[UPS] Found media, switching to slow poll");
    } else if (scanAttempts >= maxScans) {
      clearInterval(scanInterval);
      console.log("[UPS] No media found after 30s, stopping scan");
    }
  }, 1000);

  // Listen for messages from popup/background (via bridge script)
  // Uses the new typed message handler for proper type safety
  window.addEventListener('ups-message', async (event: Event) => {
    const customEvent = event as CustomEvent;
    const { message, requestId } = customEvent.detail;

    // Find first connected media state for context
    const connectedState = Array.from(mediaElements.values()).find(s => s.connected) ?? null;

    // Create context for this request
    const context = createMessageContext(connectedState);

    // Use the typed message handler (supports both new and legacy formats)
    const response = await handleTypedMessage(message, context);

    // Send response back through CustomEvent
    window.dispatchEvent(new CustomEvent('ups-response', {
      detail: { requestId, response }
    }));
  });

  console.log("[UPS] Content script ready (MAIN world)");
}

/**
 * Clean up media elements that are no longer in the DOM.
 * YouTube Shorts and SPAs often remove/replace video elements.
 */
function cleanupRemovedElements(): void {
  for (const [element, state] of mediaElements) {
    // Check if element is still in the DOM
    if (!document.contains(element)) {
      console.log("[UPS] Cleaning up removed media element");

      // Dispose audio resources
      if (state.pipeline) {
        state.pipeline.dispose();
      }
      if (state.audioContext && state.audioContext.state !== 'closed') {
        state.audioContext.close().catch(() => {});
      }

      mediaElements.delete(element);
    }
  }
}

function registerMediaElement(element: HTMLMediaElement): void {
  // Clean up any removed elements first
  cleanupRemovedElements();

  if (mediaElements.has(element)) return;

  console.log("[UPS] Found media element:", element.tagName, element.src || "(no src yet)");

  const state: MediaState = {
    element,
    audioContext: null,
    sourceNode: null,
    pipeline: null,
    pitchFilter: null,
    connected: false,
  };

  mediaElements.set(element, state);

  // Connect when the element starts playing
  element.addEventListener("play", () => connectAudioProcessing(state), { once: true });

  // If already playing, connect now
  if (!element.paused) {
    connectAudioProcessing(state);
  }
}

/**
 * Create the appropriate pitch filter based on settings and availability.
 */
async function createPitchFilter(context: AudioContext): Promise<AudioFilter> {
  // Try RubberBand first if requested and not previously failed
  if (currentSettings.engine === 'rubberband' && !rubberbandFailed) {
    try {
      const filter = new RubberbandFilter();
      await filter.initialize(context);
      console.log("[UPS] Using RubberBand engine (high quality)");
      return filter;
    } catch (error) {
      console.warn("[UPS] RubberBand failed to load, falling back to SoundTouch:", error);
      rubberbandFailed = true;
    }
  }

  // Use SoundTouch as default/fallback
  const filter = new SoundTouchFilter();
  await filter.initialize(context);
  console.log("[UPS] Using SoundTouch engine (lightweight)");
  return filter;
}

async function connectAudioProcessing(state: MediaState): Promise<void> {
  if (state.connected) return;

  try {
    // Create audio context if needed
    if (!state.audioContext) {
      state.audioContext = new AudioContext();
    }

    // Resume context (required after user gesture)
    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }

    // Create source node from media element
    if (!state.sourceNode) {
      state.sourceNode = state.audioContext.createMediaElementSource(state.element);
    }

    // Create the filter pipeline
    state.pipeline = new FilterPipeline();

    // Create and add the pitch filter
    state.pitchFilter = await createPitchFilter(state.audioContext);
    await state.pipeline.addFilter(state.pitchFilter);

    // Initialize the pipeline
    await state.pipeline.initialize(state.audioContext);

    // Connect the audio graph: source -> pipeline -> destination
    state.sourceNode.connect(state.pipeline.inputNode);
    state.pipeline.outputNode.connect(state.audioContext.destination);

    // Apply current settings
    applySettings(state);

    state.connected = true;
    console.log("[UPS] Audio processing connected for:", state.element.tagName);

  } catch (error) {
    console.error("[UPS] Failed to connect audio processing:", error);
  }
}

/**
 * Apply current settings to a media state's filter.
 */
function applySettings(state: MediaState): void {
  if (!state.pitchFilter) return;

  state.pitchFilter.setParameter('semitone', currentSettings.semitone);
  state.pitchFilter.setParameter('cents', currentSettings.cents);

  // Formant is only available on RubberBand
  if (state.pitchFilter.name === 'rubberband') {
    state.pitchFilter.setParameter('formant', currentSettings.formant);
  }

  state.pitchFilter.bypassed = !currentSettings.enabled;

  // Easter egg: Vinesauce Mode - enable the cursed chorus effect
  // This sets the dry gain to 1.0, playing both original and pitched audio
  applyVinesauceMode(state);
}

/**
 * Apply Vinesauce Mode easter egg - the cursed chorus effect
 * When enabled, both dry (original) and wet (pitched) signals play simultaneously
 */
function applyVinesauceMode(state: MediaState): void {
  const filter = state.pitchFilter as any;
  if (!filter?.dryGain) return;

  if (vinesauceMode) {
    // Cursed mode: both signals at full volume
    filter.dryGain.gain.value = 1.0;
    filter.bypassGain.gain.value = 1.0;
  } else {
    // Normal mode: only wet signal (handled by updateBypassState)
    filter.dryGain.gain.value = filter._bypassed ? 1.0 : 0.0;
    filter.bypassGain.gain.value = filter._bypassed ? 0.0 : 1.0;
  }
}

// =============================================================================
// Message Context Factory
// =============================================================================

/**
 * Create a MessageContext for the typed message handler.
 * Bridges the content script's state with the handler's interface.
 */
function createMessageContext(state: MediaState | null): MessageContext {
  return {
    // The filter pipeline for the current media element
    pipeline: state?.pipeline ?? null,

    // Map of active filter instances by instance ID
    // Cast to match MessageContext interface (id field maps to instanceId)
    filters: filterInstances as Map<string, { id: string; filter: AudioFilter }>,

    getPipeline() {
      return state?.pipeline ?? null;
    },

    async addFilter(typeId: string, insertAt?: number) {
      // Need a connected media state with audio context
      const activeState = state || Array.from(mediaElements.values()).find(s => s.connected);
      if (!activeState?.audioContext || !activeState?.pipeline) {
        throw new Error('No connected media. Play something first!');
      }

      // Try registry first, then fall back to built-in classes
      let filter: AudioFilter | null = FilterRegistry.create(typeId);

      if (!filter) {
        // Fallback for direct filter type names
        switch (typeId.toLowerCase()) {
          case 'eq':
          case 'parametric-eq':
            filter = new ParametricEQFilter();
            break;
          case 'compressor':
            filter = new CompressorFilter();
            break;
          case 'delay':
            filter = new DelayFilter();
            break;
          case 'soundtouch':
            filter = new SoundTouchFilter();
            break;
          case 'rubberband':
            filter = new RubberbandFilter();
            break;
          default:
            throw new Error(`Unknown filter type: ${typeId}`);
        }
      }

      await filter.initialize(activeState.audioContext);

      if (insertAt !== undefined) {
        await activeState.pipeline.insertFilter(filter, insertAt);
      } else {
        await activeState.pipeline.addFilter(filter);
      }

      const instanceId = generateInstanceId(typeId);
      filterInstances.set(instanceId, { id: instanceId, filter, typeId });

      console.log(`[UPS] Added filter: ${filter.displayName} (id: ${instanceId})`);
      return { instanceId, filter };
    },

    async removeFilter(instanceId: string) {
      const tracked = filterInstances.get(instanceId);
      if (!tracked) return false;

      const activeState = state || Array.from(mediaElements.values()).find(s => s.connected);
      if (activeState?.pipeline) {
        await activeState.pipeline.removeFilter(tracked.filter);
      }

      filterInstances.delete(instanceId);
      console.log(`[UPS] Removed filter: ${instanceId}`);
      return true;
    },

    hostname: window.location.hostname,
    siteMode: 'neutral', // TODO: Load from storage

    get mediaCount() {
      return mediaElements.size;
    },

    get connectedCount() {
      return Array.from(mediaElements.values()).filter(s => s.connected).length;
    },

    vinesauceMode,

    toggleVinesauce() {
      vinesauceMode = !vinesauceMode;
      console.log(`[UPS] ${vinesauceMode ? 'VINESAUCE MODE ACTIVATED' : 'Vinesauce mode disabled'}`);
      for (const s of mediaElements.values()) {
        applyVinesauceMode(s);
      }
      return vinesauceMode;
    },

    cleanup() {
      const before = mediaElements.size;
      cleanupRemovedElements();
      const after = mediaElements.size;
      return { cleaned: before - after, remaining: after };
    },

    getAvailableFilters() {
      return FilterRegistry.getAllInfo().map(info => ({
        id: info.id,
        displayName: info.displayName,
        description: info.description,
        category: info.category,
        tags: info.tags,
        parameters: info.parameters,
        requiresWasm: info.requiresWasm,
        cpuUsage: info.cpuUsage,
      }));
    },

    getFilterInfo(typeId: string) {
      const info = FilterRegistry.getInfo(typeId);
      if (!info) return null;
      return {
        id: info.id,
        displayName: info.displayName,
        description: info.description,
        category: info.category,
        tags: info.tags,
        parameters: info.parameters,
        requiresWasm: info.requiresWasm,
        cpuUsage: info.cpuUsage,
      };
    },

    async moveFilter(instanceId: string, toIndex: number) {
      const tracked = filterInstances.get(instanceId);
      if (!tracked) return;

      const activeState = state || Array.from(mediaElements.values()).find(s => s.connected);
      if (!activeState?.pipeline) return;

      const chain = activeState.pipeline.chain;
      const fromIndex = chain.indexOf(tracked.filter);
      if (fromIndex !== -1 && fromIndex !== toIndex) {
        activeState.pipeline.moveFilter(fromIndex, toIndex);
      }
    },
  };
}

// =============================================================================
// Legacy Message Handler (kept for reference, will be replaced)
// =============================================================================

/**
 * Handle messages from popup/background.
 * @deprecated Use createMessageContext + handleTypedMessage instead
 */
function handleMessage(message: any, sendResponse: (response: any) => void): void {
  switch (message.command) {
    case "get-status":
      sendResponse({
        mediaCount: mediaElements.size,
        connectedCount: Array.from(mediaElements.values()).filter(s => s.connected).length,
        settings: currentSettings,
        engine: rubberbandFailed ? 'soundtouch' : currentSettings.engine,
        rubberbandAvailable: !rubberbandFailed,
      });
      break;

    case "set-params":
      // Update settings
      if (message.params.semitone !== undefined) {
        currentSettings.semitone = message.params.semitone;
      }
      if (message.params.cents !== undefined) {
        currentSettings.cents = message.params.cents;
      }
      if (message.params.formant !== undefined) {
        currentSettings.formant = message.params.formant;
      }
      if (message.params.enabled !== undefined) {
        currentSettings.enabled = message.params.enabled;
      }

      // Apply to all connected elements
      for (const state of mediaElements.values()) {
        applySettings(state);
      }
      sendResponse({ success: true });
      break;

    case "set-engine":
      if (message.engine === 'rubberband' || message.engine === 'soundtouch') {
        currentSettings.engine = message.engine;
        // Engine change requires reconnecting all audio
        // For now, just note it - it'll apply on next page load
        sendResponse({ success: true, requiresReload: true });
      } else {
        sendResponse({ error: "Unknown engine" });
      }
      break;

    case "reset":
      currentSettings = {
        semitone: 0,
        cents: 0,
        formant: 1.0,
        enabled: true,
        engine: currentSettings.engine,
      };
      for (const state of mediaElements.values()) {
        applySettings(state);
      }
      sendResponse({ success: true });
      break;

    case "get-filters":
      // Return info about active filters for UI
      // Each filter has a unique ID for tracking multiple instances
      const filterInfo = [];

      // Add pitch filter(s) from media elements
      for (const state of mediaElements.values()) {
        if (state.pitchFilter) {
          filterInfo.push({
            id: 'pitch-main',  // Special ID for the main pitch filter
            name: state.pitchFilter.name,
            displayName: state.pitchFilter.displayName,
            description: state.pitchFilter.description,
            parameters: state.pitchFilter.parameters,
            state: state.pitchFilter.getState(),
            isPitch: true,  // Flag to distinguish from additional filters
          });
        }
      }

      // Add additional filters with their unique IDs
      for (const [id, tracked] of additionalFilters) {
        filterInfo.push({
          id,
          name: tracked.filter.name,
          displayName: tracked.filter.displayName,
          description: tracked.filter.description,
          parameters: tracked.filter.parameters,
          state: tracked.filter.getState(),
          isPitch: false,
        });
      }

      sendResponse({ filters: filterInfo });
      break;

    // Easter egg: Vinesauce Mode
    // Send { command: "vinesauce" } to toggle the cursed chorus effect
    case "vinesauce":
      vinesauceMode = !vinesauceMode;
      console.log(`[UPS] ${vinesauceMode ? 'VINESAUCE MODE ACTIVATED' : 'Vinesauce mode disabled'}`);
      for (const state of mediaElements.values()) {
        applyVinesauceMode(state);
      }
      sendResponse({
        success: true,
        vinesauceMode,
        message: vinesauceMode
          ? 'Blame Gray Leno for this'
          : 'Normal mode restored'
      });
      break;

    // Add filter from popup UI
    case "add-filter":
      handleAddFilter(message.filterType, sendResponse);
      break;

    // Remove filter from popup UI
    case "remove-filter":
      handleRemoveFilter(message.filterId, sendResponse);
      break;

    // Cleanup removed elements
    case "cleanup":
      const before = mediaElements.size;
      cleanupRemovedElements();
      const after = mediaElements.size;
      sendResponse({
        success: true,
        message: `Cleaned up ${before - after} removed elements. ${after} remain.`
      });
      break;

    default:
      sendResponse({ error: "Unknown command" });
  }
}

/**
 * Handle add-filter command from popup
 */
async function handleAddFilter(filterType: string, sendResponse: (r: any) => void): Promise<void> {
  // Find a connected media state
  const state = Array.from(mediaElements.values()).find(s => s.connected);
  if (!state || !state.audioContext || !state.pipeline) {
    sendResponse({ error: "No connected media. Play something first!" });
    return;
  }

  let filter: AudioFilter;

  try {
    switch (filterType?.toLowerCase()) {
      case 'eq':
      case 'parametric-eq':
        filter = new ParametricEQFilter();
        break;
      case 'compressor':
        filter = new CompressorFilter();
        break;
      case 'delay':
        filter = new DelayFilter();
        break;
      default:
        sendResponse({ error: `Unknown filter: ${filterType}` });
        return;
    }

    await filter.initialize(state.audioContext);
    await state.pipeline.addFilter(filter);

    // Generate unique ID for this instance
    const filterId = generateInstanceId(filter.name);
    filterInstances.set(filterId, { id: filterId, filter, typeId: filter.name });

    console.log(`[UPS] Added filter via popup: ${filter.displayName} (id: ${filterId})`);
    sendResponse({ success: true, filterId, filterName: filter.name });
  } catch (error) {
    console.error('[UPS] Failed to add filter:', error);
    sendResponse({ error: String(error) });
  }
}

/**
 * Handle remove-filter command from popup
 * @param filterId - The unique instance ID (not filter type name)
 */
async function handleRemoveFilter(filterId: string, sendResponse: (r: any) => void): Promise<void> {
  const state = Array.from(mediaElements.values()).find(s => s.connected);
  if (!state || !state.pipeline) {
    sendResponse({ error: "No connected media" });
    return;
  }

  const tracked = additionalFilters.get(filterId);
  if (!tracked) {
    sendResponse({ error: `Filter not found: ${filterId}` });
    return;
  }

  try {
    await state.pipeline.removeFilter(tracked.filter);
    additionalFilters.delete(filterId);
    console.log(`[UPS] Removed filter via popup: ${filterId}`);
    sendResponse({ success: true });
  } catch (error) {
    console.error('[UPS] Failed to remove filter:', error);
    sendResponse({ error: String(error) });
  }
}

// =============================================================================
// Debug API - Expose filter controls to browser console for testing
// =============================================================================

interface DebugAPI {
  /** Get the current pipeline and filters */
  getState(): { connected: number; filters: string[] };

  /** Add a filter by name: 'eq', 'compressor', 'delay' */
  addFilter(name: string): Promise<void>;

  /** Remove a filter by name */
  removeFilter(name: string): Promise<void>;

  /** Set a parameter on a filter */
  setParam(filterName: string, paramName: string, value: number): void;

  /** Get all parameters for a filter */
  getParams(filterName: string): Record<string, number | boolean> | null;

  /** List available filter types */
  listFilters(): string[];

  /** Toggle Vinesauce Mode */
  vinesauce(): void;

  /** Clean up removed media elements */
  cleanup(): void;
}

// =============================================================================
// Filter Instance Tracking
// =============================================================================

// Track all filter instances (supports multiple instances of same type)
// Key is unique instance ID, value includes both filter and its type for registry lookup
interface TrackedFilter {
  id: string;
  filter: AudioFilter;
  typeId: string;  // Registry type ID for recreating from presets
}
const filterInstances = new Map<string, TrackedFilter>();

// Also keep the old additionalFilters as an alias for backwards compat with debug API
const additionalFilters = filterInstances;

// Generate unique filter instance ID
let filterIdCounter = 0;
function generateInstanceId(typeId: string): string {
  return `${typeId}-${++filterIdCounter}-${Date.now()}`;
}
// Keep old name for backwards compat
const generateFilterId = generateInstanceId;

const debugAPI: DebugAPI = {
  getState() {
    // Clean up removed elements first
    cleanupRemovedElements();

    const allStates = Array.from(mediaElements.values());
    const connected = allStates.filter(s => s.connected).length;
    const filters: string[] = [];

    for (const state of allStates) {
      if (state.pitchFilter) {
        filters.push(state.pitchFilter.name);
      }
    }

    for (const [id, tracked] of additionalFilters) {
      filters.push(`${tracked.filter.name} (${id})`);
    }

    return {
      total: allStates.length,
      connected,
      filters,
      elements: allStates.map(s => ({
        tag: s.element.tagName,
        connected: s.connected,
        playing: !s.element.paused,
        src: s.element.src?.substring(0, 60) || '(no src)'
      }))
    };
  },

  async addFilter(name: string) {
    // Find a connected media state to get its context and pipeline
    const allStates = Array.from(mediaElements.values());
    console.log('[UPS Debug] Media states:', allStates.map(s => ({
      connected: s.connected,
      hasContext: !!s.audioContext,
      hasPipeline: !!s.pipeline,
      element: s.element.tagName,
      src: s.element.src?.substring(0, 50) || '(no src)'
    })));

    const state = allStates.find(s => s.connected);
    if (!state) {
      console.error('[UPS Debug] No connected media element found.');
      console.error('[UPS Debug] Try playing a video first, then run this command.');
      return;
    }
    if (!state.audioContext) {
      console.error('[UPS Debug] Media connected but no AudioContext');
      return;
    }
    if (!state.pipeline) {
      console.error('[UPS Debug] Media connected but no pipeline');
      return;
    }

    // Try FilterRegistry first, then fallback to built-in classes
    let filter: AudioFilter | null = FilterRegistry.create(name);

    if (!filter) {
      // Fallback for shorthand names
      switch (name.toLowerCase()) {
        case 'eq':
        case 'parametric-eq':
          filter = new ParametricEQFilter();
          break;
        case 'compressor':
          filter = new CompressorFilter();
          break;
        case 'delay':
          filter = new DelayFilter();
          break;
        default:
          console.error(`[UPS Debug] Unknown filter: ${name}`);
          console.error(`[UPS Debug] Available filters:`, FilterRegistry.getAllInfo().map(f => f.id));
          return;
      }
    }

    await filter.initialize(state.audioContext);
    await state.pipeline.addFilter(filter);

    const filterId = generateInstanceId(filter.name);
    filterInstances.set(filterId, { id: filterId, filter, typeId: filter.name });

    console.log(`[UPS Debug] Added filter: ${filter.displayName} (id: ${filterId})`);
    console.log(`[UPS Debug] Parameters:`, filter.parameters.map(p => `${p.name}: ${p.value}`));
  },

  async removeFilter(idOrName: string) {
    const state = Array.from(mediaElements.values()).find(s => s.connected);
    if (!state || !state.pipeline) {
      console.error('[UPS Debug] No connected media element.');
      return;
    }

    // Try direct ID lookup first
    let tracked = additionalFilters.get(idOrName);

    // If not found, search by filter name (for convenience)
    if (!tracked) {
      for (const [id, t] of additionalFilters) {
        if (t.filter.name === idOrName) {
          tracked = t;
          break;
        }
      }
    }

    if (!tracked) {
      console.error(`[UPS Debug] Filter not found: ${idOrName}`);
      console.error(`[UPS Debug] Active filters:`, Array.from(additionalFilters.keys()));
      return;
    }

    await state.pipeline.removeFilter(tracked.filter);
    additionalFilters.delete(tracked.id);
    console.log(`[UPS Debug] Removed filter: ${tracked.id}`);
  },

  setParam(idOrName: string, paramName: string, value: number) {
    // Find filter by ID or name
    let filter: AudioFilter | undefined;

    // Check additional filters first (by ID)
    const tracked = additionalFilters.get(idOrName);
    if (tracked) {
      filter = tracked.filter;
    }

    // Try searching by filter type name
    if (!filter) {
      for (const [, t] of additionalFilters) {
        if (t.filter.name === idOrName) {
          filter = t.filter;
          break;
        }
      }
    }

    // Check pitch filter
    if (!filter) {
      for (const state of mediaElements.values()) {
        if (state.pitchFilter?.name === idOrName) {
          filter = state.pitchFilter;
          break;
        }
      }
    }

    if (!filter) {
      console.error(`[UPS Debug] Filter not found: ${idOrName}`);
      return;
    }

    filter.setParameter(paramName, value);
    console.log(`[UPS Debug] Set ${filter.name}.${paramName} = ${value}`);
  },

  getParams(idOrName: string) {
    let filter: AudioFilter | undefined;

    const tracked = additionalFilters.get(idOrName);
    if (tracked) {
      filter = tracked.filter;
    }

    if (!filter) {
      for (const [, t] of additionalFilters) {
        if (t.filter.name === idOrName) {
          filter = t.filter;
          break;
        }
      }
    }

    if (!filter) {
      for (const state of mediaElements.values()) {
        if (state.pitchFilter?.name === idOrName) {
          filter = state.pitchFilter;
          break;
        }
      }
    }

    if (!filter) {
      console.error(`[UPS Debug] Filter not found: ${idOrName}`);
      return null;
    }

    const params: Record<string, number | boolean> = {};
    for (const p of filter.parameters) {
      params[p.name] = p.value;
    }
    return params;
  },

  listFilters() {
    // Use FilterRegistry to get all available filters
    const filters = FilterRegistry.getAllInfo();
    return filters.map(f => `${f.id} (${f.displayName})`);
  },

  vinesauce() {
    vinesauceMode = !vinesauceMode;
    console.log(`[UPS] ${vinesauceMode ? 'VINESAUCE MODE ACTIVATED' : 'Vinesauce mode disabled'}`);
    for (const state of mediaElements.values()) {
      applyVinesauceMode(state);
    }
  },

  cleanup() {
    const before = mediaElements.size;
    cleanupRemovedElements();
    const after = mediaElements.size;
    console.log(`[UPS Debug] Cleaned up ${before - after} removed elements. ${after} remain.`);
  },
};

// Expose to window for console access
(window as any).ups = debugAPI;

console.log('[UPS] Debug API available: window.ups');
console.log('[UPS] Commands: ups.addFilter("eq"), ups.setParam("parametric-eq", "lowGain", 6), ups.listFilters()');
