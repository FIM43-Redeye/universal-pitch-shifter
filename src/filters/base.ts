/**
 * Base Filter Interface
 *
 * All audio filters implement this interface, enabling a modular pipeline
 * where filters can be chained, reordered, and hot-swapped.
 *
 * Inspired by MPV's audio filter architecture - filters expose their ACTUAL
 * capabilities from the underlying library, not a simplified subset.
 */

/**
 * A single choice within an enum/select parameter
 */
export interface ParameterChoice {
  /** Internal value (often maps to library constant) */
  value: number;

  /** Display label */
  label: string;

  /** Longer description of what this option does */
  description?: string;
}

/**
 * Condition for when a parameter is visible/applicable
 */
export interface VisibilityCondition {
  /** Parameter name to check */
  parameter: string;

  /** Value(s) that make this parameter visible */
  values: number[];
}

/**
 * Base parameter properties shared by all parameter types
 */
interface BaseParameter {
  /** Unique identifier for this parameter */
  name: string;

  /** Human-readable label */
  label: string;

  /** Longer description of what this parameter does */
  description?: string;

  /** Group for UI organization (e.g., "Engine", "Quality", "Advanced") */
  group?: string;

  /** Condition for when this parameter is visible */
  visibleWhen?: VisibilityCondition;
}

/**
 * Continuous numeric parameter (slider)
 */
export interface NumberParameter extends BaseParameter {
  type: 'number';

  /** Current value */
  value: number;

  /** Default value */
  defaultValue: number;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Step size for UI controls */
  step: number;

  /** Unit label (e.g., "dB", "Hz", "st") */
  unit?: string;
}

/**
 * Boolean toggle parameter
 */
export interface BooleanParameter extends BaseParameter {
  type: 'boolean';

  /** Current value */
  value: boolean;

  /** Default value */
  defaultValue: boolean;
}

/**
 * Enum/select parameter - pick one from a list
 */
export interface EnumParameter extends BaseParameter {
  type: 'enum';

  /** Current value */
  value: number;

  /** Default value */
  defaultValue: number;

  /** Available choices */
  choices: ParameterChoice[];
}

/**
 * Union type for all parameter types
 */
export type FilterParameter = NumberParameter | BooleanParameter | EnumParameter;

/**
 * Get the current value of any parameter type
 */
export function getParameterValue(param: FilterParameter): number | boolean {
  return param.value;
}

/**
 * Check if a parameter is currently visible based on conditions
 */
export function isParameterVisible(
  param: FilterParameter,
  allParams: Map<string, FilterParameter>
): boolean {
  if (!param.visibleWhen) return true;

  const dependsOn = allParams.get(param.visibleWhen.parameter);
  if (!dependsOn) return true;

  const currentValue = dependsOn.type === 'boolean'
    ? (dependsOn.value ? 1 : 0)
    : dependsOn.value;

  return param.visibleWhen.values.includes(currentValue);
}

/**
 * Filter state for serialization/persistence.
 */
export interface FilterState {
  name: string;
  enabled: boolean;
  parameters: Record<string, number | boolean>;
}

/**
 * Base interface for all audio filters.
 */
export interface AudioFilter {
  /** Unique identifier for this filter type */
  readonly name: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Brief description of what this filter does */
  readonly description: string;

  /** List of controllable parameters - the filter's FULL capabilities */
  readonly parameters: readonly FilterParameter[];

  /** Whether the filter is currently bypassed */
  bypassed: boolean;

  /**
   * Initialize the filter for a given audio context.
   */
  initialize(context: AudioContext): Promise<void>;

  /**
   * Clean up resources when filter is removed from chain.
   */
  dispose(): void;

  /** The input node to connect to this filter. */
  readonly inputNode: AudioNode;

  /** The output node to connect from this filter. */
  readonly outputNode: AudioNode;

  /**
   * Set a parameter value by name.
   */
  setParameter(name: string, value: number | boolean): void;

  /**
   * Get current value of a parameter.
   */
  getParameter(name: string): number | boolean | undefined;

  /**
   * Reset all parameters to their default values.
   */
  resetParameters(): void;

  /**
   * Get complete filter state for serialization.
   */
  getState(): FilterState;

  /**
   * Restore filter state from serialized form.
   */
  setState(state: FilterState): void;
}

/**
 * Abstract base class providing common functionality for filters.
 */
export abstract class BaseFilter implements AudioFilter {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly description: string;

  protected context: AudioContext | null = null;
  protected _bypassed: boolean = false;
  protected _parameters: Map<string, FilterParameter> = new Map();

  protected bypassGain: GainNode | null = null;
  protected dryGain: GainNode | null = null;

  get bypassed(): boolean {
    return this._bypassed;
  }

  set bypassed(value: boolean) {
    this._bypassed = value;
    this.updateBypassState();
  }

  get parameters(): readonly FilterParameter[] {
    return Array.from(this._parameters.values());
  }

  /**
   * Get only the currently visible parameters (respecting visibility conditions)
   */
  get visibleParameters(): readonly FilterParameter[] {
    return this.parameters.filter(p => isParameterVisible(p, this._parameters));
  }

  abstract get inputNode(): AudioNode;
  abstract get outputNode(): AudioNode;

  abstract initialize(context: AudioContext): Promise<void>;

  dispose(): void {
    this.bypassGain?.disconnect();
    this.dryGain?.disconnect();
    this.context = null;
  }

  setParameter(name: string, value: number | boolean): void {
    const param = this._parameters.get(name);
    if (!param) {
      console.warn(`[${this.name}] Unknown parameter: ${name}`);
      return;
    }

    if (param.type === 'number') {
      const numValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      // Clamp to valid range
      const clamped = Math.max(param.min, Math.min(param.max, numValue));
      param.value = clamped;
      this.onParameterChanged(name, clamped);
    } else if (param.type === 'boolean') {
      const boolValue = typeof value === 'boolean' ? value : value !== 0;
      param.value = boolValue;
      this.onParameterChanged(name, boolValue ? 1 : 0);
    } else if (param.type === 'enum') {
      const numValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      // Validate it's a valid choice
      if (param.choices.some(c => c.value === numValue)) {
        param.value = numValue;
        this.onParameterChanged(name, numValue);
      } else {
        console.warn(`[${this.name}] Invalid enum value for ${name}: ${numValue}`);
      }
    }
  }

  getParameter(name: string): number | boolean | undefined {
    const param = this._parameters.get(name);
    if (!param) return undefined;
    return param.value;
  }

  resetParameters(): void {
    for (const param of this._parameters.values()) {
      param.value = param.defaultValue;
      const numericValue = param.type === 'boolean'
        ? (param.defaultValue ? 1 : 0)
        : param.defaultValue;
      this.onParameterChanged(param.name, numericValue);
    }
  }

  getState(): FilterState {
    const parameters: Record<string, number | boolean> = {};
    for (const [name, param] of this._parameters) {
      parameters[name] = param.value;
    }
    return {
      name: this.name,
      enabled: !this._bypassed,
      parameters,
    };
  }

  setState(state: FilterState): void {
    this._bypassed = !state.enabled;
    this.updateBypassState();

    for (const [name, value] of Object.entries(state.parameters)) {
      this.setParameter(name, value);
    }
  }

  /**
   * Called when a parameter value changes.
   * Override to update AudioWorklet parameters, call library functions, etc.
   */
  protected abstract onParameterChanged(name: string, value: number): void;

  /**
   * Update the audio graph based on bypass state.
   */
  protected updateBypassState(): void {
    if (!this.bypassGain || !this.dryGain) return;

    if (this._bypassed) {
      this.bypassGain.gain.value = 0;
      this.dryGain.gain.value = 1;
    } else {
      this.bypassGain.gain.value = 1;
      this.dryGain.gain.value = 0;
    }
  }

  /**
   * Register a number parameter
   */
  protected registerNumber(param: Omit<NumberParameter, 'type'>): void {
    this._parameters.set(param.name, { ...param, type: 'number' });
  }

  /**
   * Register a boolean parameter
   */
  protected registerBoolean(param: Omit<BooleanParameter, 'type'>): void {
    this._parameters.set(param.name, { ...param, type: 'boolean' });
  }

  /**
   * Register an enum parameter
   */
  protected registerEnum(param: Omit<EnumParameter, 'type'>): void {
    this._parameters.set(param.name, { ...param, type: 'enum' });
  }

  /**
   * Legacy helper - register from old format
   * @deprecated Use registerNumber, registerBoolean, or registerEnum instead
   */
  protected registerParameter(param: FilterParameter): void {
    this._parameters.set(param.name, { ...param });
  }
}
