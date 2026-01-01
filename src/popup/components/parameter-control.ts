/**
 * Parameter Control Component
 *
 * Auto-generates UI controls from FilterParameter metadata.
 * Supports number (slider), boolean (toggle), and enum (select) types.
 */

import type { FilterParameter, NumberParameter, BooleanParameter, EnumParameter } from '../../filters/base';
import { isParameterVisible } from '../../filters/base';

// =============================================================================
// Types
// =============================================================================

/**
 * Callback when a parameter value changes.
 */
export type ParameterChangeCallback = (name: string, value: number | boolean) => void;

/**
 * Options for creating a parameter control.
 */
export interface ParameterControlOptions {
  /** Callback when value changes */
  onChange: ParameterChangeCallback;

  /** All parameters (for visibility conditions) */
  allParameters?: Map<string, FilterParameter>;

  /** Compact mode (smaller controls) */
  compact?: boolean;
}

// =============================================================================
// Control Creation
// =============================================================================

/**
 * Create a control element for a parameter.
 */
export function createParameterControl(
  param: FilterParameter,
  options: ParameterControlOptions
): HTMLElement {
  // Check visibility condition
  if (options.allParameters && !isParameterVisible(param, options.allParameters)) {
    // Return hidden element that can be shown later
    const hidden = document.createElement('div');
    hidden.className = 'param-control hidden';
    hidden.dataset.paramName = param.name;
    return hidden;
  }

  switch (param.type) {
    case 'number':
      return createNumberControl(param, options);
    case 'boolean':
      return createBooleanControl(param, options);
    case 'enum':
      return createEnumControl(param, options);
  }
}

/**
 * Create a slider control for a number parameter.
 */
function createNumberControl(
  param: NumberParameter,
  options: ParameterControlOptions
): HTMLElement {
  const container = document.createElement('div');
  container.className = `param-control param-number ${options.compact ? 'compact' : ''}`;
  container.dataset.paramName = param.name;

  // Label row with current value
  const labelRow = document.createElement('div');
  labelRow.className = 'param-label-row';

  const label = document.createElement('label');
  label.textContent = param.label;
  label.htmlFor = `param-${param.name}`;

  const valueDisplay = document.createElement('span');
  valueDisplay.className = 'param-value';
  valueDisplay.textContent = formatValue(param.value, param.unit);

  labelRow.appendChild(label);
  labelRow.appendChild(valueDisplay);

  // Slider
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = `param-${param.name}`;
  slider.className = 'param-slider';
  slider.min = String(param.min);
  slider.max = String(param.max);
  slider.step = String(param.step);
  slider.value = String(param.value);

  // Update on input
  slider.addEventListener('input', () => {
    const value = parseFloat(slider.value);
    valueDisplay.textContent = formatValue(value, param.unit);
    options.onChange(param.name, value);
  });

  // Range labels (min/default/max)
  const rangeLabels = document.createElement('div');
  rangeLabels.className = 'param-range-labels';
  rangeLabels.innerHTML = `
    <span>${formatValue(param.min, param.unit)}</span>
    <span class="default-mark" title="Default: ${formatValue(param.defaultValue, param.unit)}">${formatValue(param.defaultValue, param.unit)}</span>
    <span>${formatValue(param.max, param.unit)}</span>
  `;

  container.appendChild(labelRow);
  container.appendChild(slider);
  container.appendChild(rangeLabels);

  // Add description tooltip if present
  if (param.description) {
    container.title = param.description;
  }

  return container;
}

/**
 * Create a toggle control for a boolean parameter.
 */
function createBooleanControl(
  param: BooleanParameter,
  options: ParameterControlOptions
): HTMLElement {
  const container = document.createElement('div');
  container.className = `param-control param-boolean ${options.compact ? 'compact' : ''}`;
  container.dataset.paramName = param.name;

  const labelRow = document.createElement('div');
  labelRow.className = 'param-toggle-row';

  const label = document.createElement('label');
  label.textContent = param.label;
  label.htmlFor = `param-${param.name}`;

  // Toggle switch
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = `param-${param.name}`;
  toggle.className = `param-toggle ${param.value ? 'active' : ''}`;
  toggle.textContent = param.value ? 'On' : 'Off';

  toggle.addEventListener('click', () => {
    const newValue = !toggle.classList.contains('active');
    toggle.classList.toggle('active', newValue);
    toggle.textContent = newValue ? 'On' : 'Off';
    options.onChange(param.name, newValue);
  });

  labelRow.appendChild(label);
  labelRow.appendChild(toggle);

  container.appendChild(labelRow);

  if (param.description) {
    container.title = param.description;
  }

  return container;
}

/**
 * Create a select control for an enum parameter.
 */
function createEnumControl(
  param: EnumParameter,
  options: ParameterControlOptions
): HTMLElement {
  const container = document.createElement('div');
  container.className = `param-control param-enum ${options.compact ? 'compact' : ''}`;
  container.dataset.paramName = param.name;

  const labelRow = document.createElement('div');
  labelRow.className = 'param-label-row';

  const label = document.createElement('label');
  label.textContent = param.label;
  label.htmlFor = `param-${param.name}`;

  labelRow.appendChild(label);

  // Select dropdown
  const select = document.createElement('select');
  select.id = `param-${param.name}`;
  select.className = 'param-select';

  for (const choice of param.choices) {
    const option = document.createElement('option');
    option.value = String(choice.value);
    option.textContent = choice.label;
    option.selected = choice.value === param.value;
    if (choice.description) {
      option.title = choice.description;
    }
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    const value = parseInt(select.value, 10);
    options.onChange(param.name, value);
  });

  container.appendChild(labelRow);
  container.appendChild(select);

  if (param.description) {
    container.title = param.description;
  }

  return container;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Format a numeric value with optional unit.
 */
function formatValue(value: number, unit?: string): string {
  // Handle special formatting based on unit
  let formatted: string;

  if (unit === 'dB' || unit === 'st') {
    // Show sign for dB and semitones
    formatted = value > 0 ? `+${value}` : String(value);
  } else if (unit === 'Hz' && value >= 1000) {
    // Show kHz for large frequencies
    formatted = `${(value / 1000).toFixed(1)}k`;
    unit = 'Hz';
  } else if (Number.isInteger(value)) {
    formatted = String(value);
  } else {
    // Round to 2 decimal places
    formatted = value.toFixed(2).replace(/\.?0+$/, '');
  }

  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Update a control's value without triggering the change callback.
 */
export function updateControlValue(
  container: HTMLElement,
  paramName: string,
  value: number | boolean
): void {
  const control = container.querySelector(`[data-param-name="${paramName}"]`);
  if (!control) return;

  if (typeof value === 'boolean') {
    // Boolean toggle
    const toggle = control.querySelector('.param-toggle');
    if (toggle) {
      toggle.classList.toggle('active', value);
      toggle.textContent = value ? 'On' : 'Off';
    }
  } else if (typeof value === 'number') {
    // Number slider or enum select
    const slider = control.querySelector('.param-slider') as HTMLInputElement | null;
    const select = control.querySelector('.param-select') as HTMLSelectElement | null;
    const valueDisplay = control.querySelector('.param-value');

    if (slider) {
      slider.value = String(value);
      // Get unit from data attribute or infer from existing display
      const existingText = valueDisplay?.textContent || '';
      const unit = existingText.split(' ').pop();
      if (valueDisplay) {
        valueDisplay.textContent = formatValue(value, unit !== String(value) ? unit : undefined);
      }
    } else if (select) {
      select.value = String(value);
    }
  }
}

/**
 * Update visibility of controls based on current parameter values.
 */
export function updateControlVisibility(
  container: HTMLElement,
  allParameters: Map<string, FilterParameter>
): void {
  const controls = container.querySelectorAll('.param-control');

  for (const control of controls) {
    const paramName = (control as HTMLElement).dataset.paramName;
    if (!paramName) continue;

    const param = allParameters.get(paramName);
    if (!param) continue;

    const visible = isParameterVisible(param, allParameters);
    control.classList.toggle('hidden', !visible);
  }
}

/**
 * Group parameters by their group property.
 */
export function groupParameters(
  parameters: FilterParameter[]
): Map<string, FilterParameter[]> {
  const groups = new Map<string, FilterParameter[]>();

  for (const param of parameters) {
    const groupName = param.group || 'General';
    const existing = groups.get(groupName) || [];
    existing.push(param);
    groups.set(groupName, existing);
  }

  return groups;
}

/**
 * Create a parameter group container with all its controls.
 */
export function createParameterGroup(
  groupName: string,
  parameters: FilterParameter[],
  options: ParameterControlOptions
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'param-group';

  // Group header (collapsible)
  const header = document.createElement('div');
  header.className = 'param-group-header';
  header.innerHTML = `
    <span class="param-group-name">${groupName}</span>
    <span class="param-group-chevron">-</span>
  `;

  const content = document.createElement('div');
  content.className = 'param-group-content';

  // Create all parameter controls
  for (const param of parameters) {
    const control = createParameterControl(param, options);
    content.appendChild(control);
  }

  // Toggle collapse on header click
  header.addEventListener('click', () => {
    const isCollapsed = content.classList.toggle('collapsed');
    const chevron = header.querySelector('.param-group-chevron');
    if (chevron) {
      chevron.textContent = isCollapsed ? '+' : '-';
    }
  });

  container.appendChild(header);
  container.appendChild(content);

  return container;
}
