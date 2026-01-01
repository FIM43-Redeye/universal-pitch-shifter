/**
 * Filter Panel Component
 *
 * A collapsible card showing an active filter with all its parameters.
 * Supports drag-and-drop reordering, enable/disable, and removal.
 */

import type { ActiveFilterInfo, FilterInfoMessage } from '../../lib/messages/types';
import type { FilterParameter } from '../../filters/base';
import {
  createParameterControl,
  groupParameters,
  createParameterGroup,
  updateControlValue,
  type ParameterChangeCallback,
} from './parameter-control';

// =============================================================================
// Types
// =============================================================================

/**
 * Callbacks for filter panel actions.
 */
export interface FilterPanelCallbacks {
  /** Called when a parameter value changes */
  onParameterChange: (instanceId: string, paramName: string, value: number | boolean) => void;

  /** Called when the filter is enabled/disabled */
  onEnabledChange: (instanceId: string, enabled: boolean) => void;

  /** Called when the filter should be removed */
  onRemove: (instanceId: string) => void;

  /** Called when the filter should be moved */
  onMove?: (instanceId: string, direction: 'up' | 'down') => void;

  /** Called when the filter is reset to defaults */
  onReset?: (instanceId: string) => void;
}

// =============================================================================
// Filter Panel
// =============================================================================

/**
 * Create a filter panel element.
 */
export function createFilterPanel(
  filter: ActiveFilterInfo,
  filterInfo: FilterInfoMessage | null,
  callbacks: FilterPanelCallbacks,
  collapsed: boolean = false
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = `filter-panel ${collapsed ? 'collapsed' : ''} ${!filter.enabled ? 'disabled' : ''}`;
  panel.dataset.instanceId = filter.instanceId;
  panel.dataset.filterType = filter.typeId;

  // Header
  const header = createPanelHeader(filter, filterInfo, callbacks, collapsed);
  panel.appendChild(header);

  // Content (parameters)
  const content = document.createElement('div');
  content.className = 'filter-panel-content';

  if (filterInfo && filterInfo.parameters.length > 0) {
    // Group parameters
    const groups = groupParameters(filterInfo.parameters);

    // Build parameter map for visibility conditions
    const paramMap = new Map<string, FilterParameter>();
    for (const param of filterInfo.parameters) {
      // Set current value from filter state
      const currentValue = filter.parameters[param.name];
      if (currentValue !== undefined) {
        (param as { value: number | boolean }).value = currentValue;
      }
      paramMap.set(param.name, param);
    }

    // Create onChange handler
    const onChange: ParameterChangeCallback = (name, value) => {
      callbacks.onParameterChange(filter.instanceId, name, value);
    };

    // If only one group and it's "General", don't show group header
    if (groups.size === 1 && groups.has('General')) {
      const params = groups.get('General')!;
      for (const param of params) {
        const control = createParameterControl(param, {
          onChange,
          allParameters: paramMap,
          compact: true,
        });
        content.appendChild(control);
      }
    } else {
      // Multiple groups - create collapsible sections
      for (const [groupName, params] of groups) {
        const group = createParameterGroup(groupName, params, {
          onChange,
          allParameters: paramMap,
          compact: true,
        });
        content.appendChild(group);
      }
    }
  } else {
    // No parameters
    const noParams = document.createElement('div');
    noParams.className = 'filter-panel-no-params';
    noParams.textContent = 'No adjustable parameters';
    content.appendChild(noParams);
  }

  panel.appendChild(content);

  return panel;
}

/**
 * Create the panel header with controls.
 */
function createPanelHeader(
  filter: ActiveFilterInfo,
  filterInfo: FilterInfoMessage | null,
  callbacks: FilterPanelCallbacks,
  collapsed: boolean
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'filter-panel-header';

  // Drag handle
  const dragHandle = document.createElement('span');
  dragHandle.className = 'filter-panel-drag';
  dragHandle.innerHTML = '&#x2630;'; // Hamburger icon
  dragHandle.title = 'Drag to reorder';

  // Title
  const title = document.createElement('span');
  title.className = 'filter-panel-title';
  title.textContent = filter.displayName;

  // Info indicator (CPU usage)
  const info = document.createElement('span');
  info.className = 'filter-panel-info';
  if (filterInfo) {
    const cpuClass = {
      low: 'cpu-low',
      medium: 'cpu-medium',
      high: 'cpu-high',
    }[filterInfo.cpuUsage];
    info.className += ` ${cpuClass}`;
    info.title = `CPU: ${filterInfo.cpuUsage}`;
  }

  // Controls
  const controls = document.createElement('div');
  controls.className = 'filter-panel-controls';

  // Enable toggle
  const enableBtn = document.createElement('button');
  enableBtn.className = `filter-panel-btn enable-btn ${filter.enabled ? 'active' : ''}`;
  enableBtn.innerHTML = filter.enabled ? '&#x2713;' : '&#x2715;'; // Check or X
  enableBtn.title = filter.enabled ? 'Enabled (click to disable)' : 'Disabled (click to enable)';
  enableBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const newEnabled = !enableBtn.classList.contains('active');
    enableBtn.classList.toggle('active', newEnabled);
    enableBtn.innerHTML = newEnabled ? '&#x2713;' : '&#x2715;';
    enableBtn.title = newEnabled ? 'Enabled (click to disable)' : 'Disabled (click to enable)';

    // Update panel style
    const panel = enableBtn.closest('.filter-panel');
    panel?.classList.toggle('disabled', !newEnabled);

    callbacks.onEnabledChange(filter.instanceId, newEnabled);
  });

  // Collapse toggle
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'filter-panel-btn collapse-btn';
  collapseBtn.innerHTML = collapsed ? '+' : '-';
  collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = collapseBtn.closest('.filter-panel');
    const isCollapsed = panel?.classList.toggle('collapsed');
    collapseBtn.innerHTML = isCollapsed ? '+' : '-';
    collapseBtn.title = isCollapsed ? 'Expand' : 'Collapse';
  });

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'filter-panel-btn remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.title = 'Remove filter';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Confirm for non-trivial filters
    if (filterInfo && filterInfo.parameters.length > 0) {
      if (!confirm(`Remove ${filter.displayName}?`)) {
        return;
      }
    }
    callbacks.onRemove(filter.instanceId);
  });

  controls.appendChild(enableBtn);
  controls.appendChild(collapseBtn);
  controls.appendChild(removeBtn);

  // Click on header to toggle collapse
  header.addEventListener('click', () => {
    const panel = header.closest('.filter-panel');
    const isCollapsed = panel?.classList.toggle('collapsed');
    collapseBtn.innerHTML = isCollapsed ? '+' : '-';
    collapseBtn.title = isCollapsed ? 'Expand' : 'Collapse';
  });

  header.appendChild(dragHandle);
  header.appendChild(title);
  header.appendChild(info);
  header.appendChild(controls);

  return header;
}

/**
 * Update parameter values on an existing panel.
 */
export function updateFilterPanel(
  panel: HTMLElement,
  filter: ActiveFilterInfo
): void {
  // Update enabled state
  const enableBtn = panel.querySelector('.enable-btn');
  if (enableBtn) {
    enableBtn.classList.toggle('active', filter.enabled);
    enableBtn.innerHTML = filter.enabled ? '&#x2713;' : '&#x2715;';
  }
  panel.classList.toggle('disabled', !filter.enabled);

  // Update parameter values
  const content = panel.querySelector('.filter-panel-content');
  if (content) {
    for (const [name, value] of Object.entries(filter.parameters)) {
      updateControlValue(content as HTMLElement, name, value);
    }
  }
}

/**
 * Create the empty state message for when no filters are active.
 */
export function createEmptyFiltersMessage(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'filters-empty';
  empty.innerHTML = `
    <div class="filters-empty-icon">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12" y2="16"/>
      </svg>
    </div>
    <p class="filters-empty-text">No filters active</p>
    <p class="filters-empty-hint">Click "Add Filter" to get started</p>
  `;
  return empty;
}

// =============================================================================
// Drag and Drop
// =============================================================================

/**
 * Enable drag-and-drop reordering for filter panels.
 */
export function enablePanelDragDrop(
  container: HTMLElement,
  onReorder: (instanceId: string, newIndex: number) => void
): void {
  let draggedPanel: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;

  container.addEventListener('dragstart', (e) => {
    const handle = (e.target as HTMLElement).closest('.filter-panel-drag');
    if (!handle) return;

    const panel = handle.closest('.filter-panel') as HTMLElement;
    if (!panel) return;

    draggedPanel = panel;
    panel.classList.add('dragging');

    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'filter-panel-placeholder';
    placeholder.style.height = `${panel.offsetHeight}px`;

    // Set drag data
    e.dataTransfer?.setData('text/plain', panel.dataset.instanceId || '');
    e.dataTransfer!.effectAllowed = 'move';
  });

  container.addEventListener('dragend', () => {
    if (draggedPanel) {
      draggedPanel.classList.remove('dragging');
      draggedPanel = null;
    }
    if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedPanel || !placeholder) return;

    const afterElement = getDragAfterElement(container, e.clientY);

    if (afterElement) {
      container.insertBefore(placeholder, afterElement);
    } else {
      container.appendChild(placeholder);
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedPanel || !placeholder) return;

    const instanceId = draggedPanel.dataset.instanceId;
    if (!instanceId) return;

    // Calculate new index
    const panels = Array.from(container.querySelectorAll('.filter-panel:not(.dragging)'));
    const placeholderIndex = Array.from(container.children).indexOf(placeholder);

    // Insert panel at placeholder position
    container.insertBefore(draggedPanel, placeholder);
    placeholder.remove();
    placeholder = null;

    // Notify of reorder
    onReorder(instanceId, placeholderIndex);
  });

  // Make drag handles draggable
  container.querySelectorAll('.filter-panel-drag').forEach((handle) => {
    const panel = handle.closest('.filter-panel');
    if (panel) {
      (panel as HTMLElement).draggable = true;
    }
  });
}

/**
 * Get the element to insert after during drag.
 */
function getDragAfterElement(container: HTMLElement, y: number): Element | null {
  const panels = Array.from(
    container.querySelectorAll('.filter-panel:not(.dragging)')
  );

  let closest: { offset: number; element: Element | null } = {
    offset: Number.NEGATIVE_INFINITY,
    element: null,
  };

  for (const panel of panels) {
    const box = panel.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: panel };
    }
  }

  return closest.element;
}
