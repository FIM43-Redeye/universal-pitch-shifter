/**
 * RubberBand Pitch Shifting Filter
 *
 * High-quality pitch shifting with formant preservation using
 * the RubberBand library compiled to WebAssembly.
 *
 * This filter exposes ALL RubberBand options - the full capabilities
 * of the underlying library, not a simplified subset.
 *
 * GPL-2.0 License (required by RubberBand)
 */

import { BaseFilter } from '../../base';
import {
  RubberbandOptionGroups,
  RubberbandContinuousParams,
  RubberbandOptionValues,
  semitonesToPitchScale,
  buildDefaultOptions,
} from './options';

/**
 * High-quality pitch shifter using RubberBand WASM
 *
 * Exposes the complete RubberBand API including:
 * - Engine selection (R2/R3)
 * - Transient, detector, phase options (R2)
 * - Window size, smoothing
 * - Formant handling
 * - Pitch mode
 * - Channel processing
 */
export class RubberbandFilter extends BaseFilter {
  readonly name = 'rubberband';
  readonly displayName = 'RubberBand Pitch Shifter';
  readonly description = 'High-quality pitch shifting with formant preservation';

  private workletNode: AudioWorkletNode | null = null;
  private _inputNode: GainNode | null = null;
  private _outputNode: GainNode | null = null;
  private wasmBytes: ArrayBuffer | null = null;
  private ready: boolean = false;

  // Track current option values for rebuilding bitmask
  private optionValues: Map<string, number> = new Map();

  constructor() {
    super();
    this.registerAllParameters();
  }

  /**
   * Register all parameters from the option definitions
   */
  private registerAllParameters(): void {
    // Register convenience parameters (semitones/cents instead of raw pitch scale)
    this.registerNumber({
      name: 'semitone',
      label: 'Semitones',
      description: 'Pitch shift in semitones',
      group: 'Pitch',
      value: 0,
      defaultValue: 0,
      min: -36,
      max: 36,
      step: 1,
      unit: 'st',
    });

    this.registerNumber({
      name: 'cents',
      label: 'Fine Tune',
      description: 'Fine pitch adjustment in cents',
      group: 'Pitch',
      value: 0,
      defaultValue: 0,
      min: -100,
      max: 100,
      step: 1,
      unit: 'cents',
    });

    // Register enum parameters from option groups
    for (const group of RubberbandOptionGroups) {
      this.optionValues.set(group.name, group.defaultValue);

      this.registerEnum({
        name: group.name,
        label: group.label,
        description: group.description,
        group: group.uiGroup,
        value: group.defaultValue,
        defaultValue: group.defaultValue,
        choices: group.choices.map(c => ({
          value: c.value,
          label: c.label,
          description: c.description,
        })),
        visibleWhen: group.visibleWhen ? {
          parameter: group.visibleWhen.option,
          values: group.visibleWhen.values,
        } : undefined,
      });
    }

    // Register continuous parameters (formant scale, etc.)
    for (const param of RubberbandContinuousParams) {
      // Skip pitchScale - we use semitone/cents instead
      if (param.name === 'pitchScale') continue;

      this.registerNumber({
        name: param.name,
        label: param.label,
        description: param.description,
        group: param.uiGroup,
        value: param.defaultValue,
        defaultValue: param.defaultValue,
        min: param.min,
        max: param.max,
        step: param.step,
        unit: param.unit,
        // Formant scale only visible when formant=preserved
        visibleWhen: param.name === 'formantScale' ? {
          parameter: 'formant',
          values: [RubberbandOptionValues.FormantPreserved],
        } : undefined,
      });
    }
  }

  get inputNode(): AudioNode {
    if (!this._inputNode) {
      throw new Error('Filter not initialized');
    }
    return this._inputNode;
  }

  get outputNode(): AudioNode {
    if (!this._outputNode) {
      throw new Error('Filter not initialized');
    }
    return this._outputNode;
  }

  async initialize(context: AudioContext): Promise<void> {
    if (this._inputNode) {
      console.warn('[RubberbandFilter] Already initialized');
      return;
    }

    this.context = context;

    // Create gain nodes
    this._inputNode = context.createGain();
    this._outputNode = context.createGain();
    this.bypassGain = context.createGain();
    this.dryGain = context.createGain();
    this.dryGain.gain.value = 0;

    // Load WASM
    if (!this.wasmBytes) {
      await this.loadWasm();
    }

    // Load worklet module
    const workletUrl = this.getWorkletUrl();
    await context.audioWorklet.addModule(workletUrl);

    // Build initial options bitmask
    const initialOptions = this.buildOptionsBitmask();

    // Create worklet node
    this.workletNode = new AudioWorkletNode(context, 'rubberband-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        wasmBytes: this.wasmBytes,
        initialOptions,
      },
    });

    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'ready') {
        this.ready = true;
        console.log('[RubberbandFilter] Processor ready');
      } else if (event.data.type === 'error') {
        console.error('[RubberbandFilter] Processor error:', event.data.message);
      }
    };

    // Wire audio graph
    this._inputNode.connect(this.dryGain);
    this.dryGain.connect(this._outputNode);

    this._inputNode.connect(this.workletNode);
    this.workletNode.connect(this.bypassGain);
    this.bypassGain.connect(this._outputNode);

    this.updateBypassState();
    this.syncAllParameters();
  }

  dispose(): void {
    this.workletNode?.disconnect();
    this.workletNode = null;
    this._inputNode?.disconnect();
    this._inputNode = null;
    this._outputNode?.disconnect();
    this._outputNode = null;
    this.ready = false;
    super.dispose();
  }

  private async loadWasm(): Promise<void> {
    const wasmUrl = this.getWasmUrl();
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to load RubberBand WASM: ${response.status}`);
    }
    this.wasmBytes = await response.arrayBuffer();
  }

  /**
   * Get URL for worklet module
   * Uses the extension URL helper provided by the content script
   */
  private getWorkletUrl(): string {
    // In MAIN world, use the helper function set up by content.ts
    const getExtensionUrl = (window as any).__ups_getExtensionUrl;
    if (typeof getExtensionUrl === 'function') {
      return getExtensionUrl('worklet/rubberband-processor.js');
    }
    // Fallback for testing outside extension context
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('worklet/rubberband-processor.js');
    }
    return '/worklet/rubberband-processor.js';
  }

  /**
   * Get URL for WASM module
   * Uses the extension URL helper provided by the content script
   */
  private getWasmUrl(): string {
    // In MAIN world, use the helper function set up by content.ts
    const getExtensionUrl = (window as any).__ups_getExtensionUrl;
    if (typeof getExtensionUrl === 'function') {
      return getExtensionUrl('wasm/rubberband.wasm');
    }
    // Fallback for testing outside extension context
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('wasm/rubberband.wasm');
    }
    return '/wasm/rubberband.wasm';
  }

  /**
   * Build the options bitmask from current parameter values
   */
  private buildOptionsBitmask(): number {
    let options = RubberbandOptionValues.ProcessRealTime;

    for (const [name, value] of this.optionValues) {
      options |= value;
    }

    return options;
  }

  protected onParameterChanged(name: string, value: number): void {
    if (!this.workletNode) return;

    // Handle pitch (semitone + cents -> pitch scale)
    if (name === 'semitone' || name === 'cents') {
      const semitone = this.getParameter('semitone') as number ?? 0;
      const cents = this.getParameter('cents') as number ?? 0;
      const totalSemitones = semitone + cents / 100;
      const pitchScale = semitonesToPitchScale(totalSemitones);

      // Send to worklet via AudioParam
      const param = this.workletNode.parameters.get('pitchScale');
      if (param) {
        param.setValueAtTime(pitchScale, this.context?.currentTime ?? 0);
      }
      return;
    }

    // Handle formant scale
    if (name === 'formantScale') {
      const param = this.workletNode.parameters.get('formantScale');
      if (param) {
        param.setValueAtTime(value, this.context?.currentTime ?? 0);
      }
      return;
    }

    // Handle option groups (need to rebuild stretcher with new options)
    const optionGroup = RubberbandOptionGroups.find(g => g.name === name);
    if (optionGroup) {
      this.optionValues.set(name, value);

      // Some options can be changed at runtime via setter functions
      if (optionGroup.runtimeSetter) {
        this.workletNode.port.postMessage({
          type: 'setOption',
          option: name,
          value: value,
          setter: optionGroup.runtimeSetter,
        });
      } else {
        // Option requires recreating the stretcher
        this.workletNode.port.postMessage({
          type: 'rebuildStretcher',
          options: this.buildOptionsBitmask(),
        });
      }
    }
  }

  private syncAllParameters(): void {
    // Sync pitch
    const semitone = this.getParameter('semitone') as number ?? 0;
    const cents = this.getParameter('cents') as number ?? 0;
    this.onParameterChanged('semitone', semitone);

    // Sync formant scale
    const formantScale = this.getParameter('formantScale') as number ?? 1.0;
    this.onParameterChanged('formantScale', formantScale);
  }

  reset(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
  }
}
