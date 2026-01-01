/**
 * Popup Script
 *
 * Filter-agnostic UI for the audio filter framework.
 * Uses typed messages and dynamically generated parameter controls.
 */

import type {
  RequestMessage,
  StatusResponse,
  PipelineStateResponse,
  AvailableFiltersResponse,
  AddFilterResponse,
  ActiveFilterInfo,
  FilterInfoMessage,
} from '../lib/messages/types';
import { showFilterBrowser } from './components/filter-browser';
import {
  createFilterPanel,
  updateFilterPanel,
  createEmptyFiltersMessage,
  enablePanelDragDrop,
} from './components/filter-panel';

// =============================================================================
// State
// =============================================================================

let currentTabId: number | null = null;
let hostname: string = '';
let siteMode: 'auto-apply' | 'neutral' | 'none' = 'neutral';
let activeFilters: ActiveFilterInfo[] = [];
let availableFilters: FilterInfoMessage[] = [];
let filterInfoCache: Map<string, FilterInfoMessage> = new Map();

// =============================================================================
// UI Elements
// =============================================================================

const statusIndicator = document.getElementById('status') as HTMLSpanElement;
const siteHostname = document.getElementById('site-hostname') as HTMLSpanElement;
const modeAutoBtn = document.getElementById('mode-auto') as HTMLButtonElement;
const modeNeutralBtn = document.getElementById('mode-neutral') as HTMLButtonElement;
const addFilterBtn = document.getElementById('add-filter-btn') as HTMLButtonElement;
const filtersContainer = document.getElementById('filters-container') as HTMLElement;
const engineLabel = document.getElementById('engine-label') as HTMLSpanElement;

// Presets
const presetsToggle = document.getElementById('presets-toggle') as HTMLElement;
const presetsContent = document.getElementById('presets-content') as HTMLElement;
const presetSaveBtn = document.getElementById('preset-save') as HTMLButtonElement;
const presetLoadBtn = document.getElementById('preset-load') as HTMLButtonElement;
const presetExportBtn = document.getElementById('preset-export') as HTMLButtonElement;

// Debug
const debugToggle = document.getElementById('debug-toggle') as HTMLElement;
const debugContent = document.getElementById('debug-content') as HTMLElement;
const debugStatusBtn = document.getElementById('debug-status') as HTMLButtonElement;
const debugCleanupBtn = document.getElementById('debug-cleanup') as HTMLButtonElement;
const debugClearBtn = document.getElementById('debug-clear') as HTMLButtonElement;
const debugVinesauceBtn = document.getElementById('debug-vinesauce') as HTMLButtonElement;
const debugOutput = document.getElementById('debug-output') as HTMLPreElement;
const debugCopyBtn = document.getElementById('debug-copy') as HTMLButtonElement;

// =============================================================================
// Initialization
// =============================================================================

async function init(): Promise<void> {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;

  if (!currentTabId) {
    setStatus('No tab', 'error');
    return;
  }

  // Set up collapsible sections
  setupCollapsible(presetsToggle, presetsContent);
  setupCollapsible(debugToggle, debugContent);

  // Set up event listeners
  addFilterBtn.addEventListener('click', handleAddFilter);
  modeAutoBtn.addEventListener('click', () => setMode('auto-apply'));
  modeNeutralBtn.addEventListener('click', () => setMode('neutral'));

  // Preset buttons
  presetSaveBtn.addEventListener('click', handlePresetSave);
  presetLoadBtn.addEventListener('click', handlePresetLoad);
  presetExportBtn.addEventListener('click', handlePresetExport);

  // Debug buttons
  debugStatusBtn.addEventListener('click', handleDebugStatus);
  debugCleanupBtn.addEventListener('click', handleDebugCleanup);
  debugClearBtn.addEventListener('click', handleDebugClear);
  debugVinesauceBtn.addEventListener('click', handleDebugVinesauce);
  debugCopyBtn.addEventListener('click', handleDebugCopy);

  // Enable drag-and-drop reordering
  enablePanelDragDrop(filtersContainer, handleFilterReorder);

  // Initial state fetch
  await refreshState();
}

// =============================================================================
// State Management
// =============================================================================

async function refreshState(): Promise<void> {
  if (!currentTabId) return;

  try {
    // Get status
    const status = await sendMessage({ type: 'GET_STATUS' }) as StatusResponse | null;

    if (status?.success) {
      hostname = status.hostname;
      siteHostname.textContent = hostname || 'Unknown site';
      siteMode = status.siteMode === 'none' ? 'neutral' : status.siteMode;
      updateModeButtons();

      if (status.engineInfo) {
        engineLabel.textContent = status.engineInfo;
      }

      if (status.connectedCount > 0) {
        setStatus(`${status.connectedCount} connected`, 'connected');
      } else if (status.mediaCount > 0) {
        setStatus(`${status.mediaCount} found`, '');
      } else {
        setStatus('No media', '');
      }
    } else {
      setStatus('Not available', 'error');
    }

    // Get available filters
    const filtersResponse = await sendMessage({ type: 'GET_AVAILABLE_FILTERS' }) as AvailableFiltersResponse | null;
    if (filtersResponse?.success) {
      availableFilters = filtersResponse.filters;
      // Cache filter info
      for (const f of availableFilters) {
        filterInfoCache.set(f.id, f);
      }
    }

    // Get pipeline state
    const pipelineResponse = await sendMessage({ type: 'GET_PIPELINE_STATE' }) as PipelineStateResponse | null;
    if (pipelineResponse?.success) {
      activeFilters = pipelineResponse.filters;
      renderFilters();
    }
  } catch (error) {
    console.error('[Popup] Failed to refresh state:', error);
    setStatus('Error', 'error');
  }
}

// =============================================================================
// Filter Management
// =============================================================================

function renderFilters(): void {
  // Clear container
  filtersContainer.innerHTML = '';

  if (activeFilters.length === 0) {
    filtersContainer.appendChild(createEmptyFiltersMessage());
    return;
  }

  // Create panels for each filter
  for (const filter of activeFilters) {
    const filterInfo = filterInfoCache.get(filter.typeId) || null;
    const panel = createFilterPanel(filter, filterInfo, {
      onParameterChange: handleParameterChange,
      onEnabledChange: handleEnabledChange,
      onRemove: handleRemoveFilter,
      onReset: handleResetFilter,
    });
    filtersContainer.appendChild(panel);
  }
}

async function handleAddFilter(): Promise<void> {
  if (availableFilters.length === 0) {
    showDebugOutput('No filters available');
    return;
  }

  showFilterBrowser(availableFilters, async (filterTypeId) => {
    const response = await sendMessage({
      type: 'ADD_FILTER',
      filterTypeId,
    }) as AddFilterResponse | null;

    if (response?.success) {
      activeFilters.push(response.filter);
      renderFilters();
      showDebugOutput(`Added: ${response.filter.displayName}`);
    } else {
      showDebugOutput(`Failed to add filter: ${(response as { error?: string })?.error || 'Unknown error'}`);
    }
  });
}

async function handleRemoveFilter(instanceId: string): Promise<void> {
  const response = await sendMessage({
    type: 'REMOVE_FILTER',
    instanceId,
  }) as { success: boolean; error?: string } | null;

  if (response?.success) {
    activeFilters = activeFilters.filter(f => f.instanceId !== instanceId);
    renderFilters();
  } else {
    showDebugOutput(`Failed to remove: ${response?.error || 'Unknown error'}`);
  }
}

async function handleParameterChange(
  instanceId: string,
  paramName: string,
  value: number | boolean
): Promise<void> {
  await sendMessage({
    type: 'SET_FILTER_PARAMETER',
    instanceId,
    paramName,
    value,
  });

  // Update local state
  const filter = activeFilters.find(f => f.instanceId === instanceId);
  if (filter) {
    filter.parameters[paramName] = value;
  }
}

async function handleEnabledChange(instanceId: string, enabled: boolean): Promise<void> {
  await sendMessage({
    type: 'SET_FILTER_ENABLED',
    instanceId,
    enabled,
  });

  // Update local state
  const filter = activeFilters.find(f => f.instanceId === instanceId);
  if (filter) {
    filter.enabled = enabled;
  }
}

async function handleResetFilter(instanceId: string): Promise<void> {
  await sendMessage({
    type: 'RESET_FILTER',
    instanceId,
  });

  // Refresh to get new values
  await refreshState();
}

async function handleFilterReorder(instanceId: string, newIndex: number): Promise<void> {
  await sendMessage({
    type: 'MOVE_FILTER',
    instanceId,
    toIndex: newIndex,
  });

  // Refresh to get correct order
  await refreshState();
}

// =============================================================================
// Site Mode
// =============================================================================

function updateModeButtons(): void {
  modeAutoBtn.classList.toggle('active', siteMode === 'auto-apply');
  modeNeutralBtn.classList.toggle('active', siteMode === 'neutral');
}

async function setMode(mode: 'auto-apply' | 'neutral'): Promise<void> {
  siteMode = mode;
  updateModeButtons();

  await sendMessage({
    type: 'SET_SITE_MODE',
    mode,
  });
}

// =============================================================================
// Presets
// =============================================================================

async function handlePresetSave(): Promise<void> {
  const name = prompt('Preset name:');
  if (!name) return;

  // TODO: Integrate with PresetManager via background script
  showDebugOutput(`Preset saving not yet implemented: "${name}"`);
}

async function handlePresetLoad(): Promise<void> {
  // TODO: Show preset picker modal
  showDebugOutput('Preset loading not yet implemented');
}

async function handlePresetExport(): Promise<void> {
  // TODO: Export presets as JSON file
  showDebugOutput('Preset export not yet implemented');
}

// =============================================================================
// Debug
// =============================================================================

async function handleDebugStatus(): Promise<void> {
  const status = await sendMessage({ type: 'GET_STATUS' });
  const pipeline = await sendMessage({ type: 'GET_PIPELINE_STATE' });
  showDebugOutput(JSON.stringify({ status, pipeline }, null, 2));
}

async function handleDebugCleanup(): Promise<void> {
  const response = await sendMessage({ type: 'CLEANUP' }) as { success: boolean; message?: string } | null;
  showDebugOutput(response?.message || JSON.stringify(response, null, 2));
  await refreshState();
}

async function handleDebugClear(): Promise<void> {
  const response = await sendMessage({ type: 'CLEAR_PIPELINE' }) as { success: boolean; error?: string } | null;
  if (response?.success) {
    activeFilters = [];
    renderFilters();
    showDebugOutput('Pipeline cleared');
  } else {
    showDebugOutput(`Clear failed: ${response?.error || 'Unknown'}`);
  }
}

async function handleDebugVinesauce(): Promise<void> {
  const response = await sendMessage({ type: 'VINESAUCE' }) as { success: boolean; vinesauceMode?: boolean; message?: string } | null;
  if (response?.vinesauceMode) {
    debugVinesauceBtn.classList.add('active');
    showDebugOutput(response.message || 'VINESAUCE MODE ACTIVATED');
  } else {
    debugVinesauceBtn.classList.remove('active');
    showDebugOutput(response?.message || 'Vinesauce mode disabled');
  }
}

async function handleDebugCopy(): Promise<void> {
  const text = debugOutput.textContent || '';
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    debugCopyBtn.textContent = 'Copied!';
    setTimeout(() => {
      debugCopyBtn.textContent = 'Copy';
    }, 1500);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

function showDebugOutput(text: string): void {
  debugOutput.textContent = text;
  // Auto-expand debug section
  if (debugContent.classList.contains('collapsed')) {
    debugContent.classList.remove('collapsed');
    const chevron = debugToggle.querySelector('.chevron');
    if (chevron) chevron.textContent = '-';
  }
}

// =============================================================================
// Utilities
// =============================================================================

function setupCollapsible(toggle: HTMLElement, content: HTMLElement): void {
  toggle.addEventListener('click', () => {
    const isCollapsed = content.classList.contains('collapsed');
    content.classList.toggle('collapsed', !isCollapsed);
    const chevron = toggle.querySelector('.chevron');
    if (chevron) {
      chevron.textContent = isCollapsed ? '-' : '+';
    }
  });
}

function setStatus(text: string, className: string): void {
  statusIndicator.textContent = text;
  statusIndicator.className = `status ${className}`;
}

async function sendMessage(message: RequestMessage): Promise<unknown> {
  if (!currentTabId) return null;

  try {
    return await chrome.tabs.sendMessage(currentTabId, message, { frameId: 0 });
  } catch (error) {
    console.error('[Popup] Message failed:', error);
    return null;
  }
}

// =============================================================================
// Start
// =============================================================================

init();
