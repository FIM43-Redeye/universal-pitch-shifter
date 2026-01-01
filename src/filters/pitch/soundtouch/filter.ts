/**
 * SoundTouch Pitch Shifting Filter
 *
 * Lightweight pure-JavaScript pitch shifter using the WSOLA algorithm.
 * Good fallback when RubberBand is too heavy or fails to load.
 *
 * GPL-2.0 License
 */

import { BaseFilter, FilterParameter } from '../../base';

/**
 * SoundTouch filter parameters
 */
const SOUNDTOUCH_PARAMETERS: FilterParameter[] = [
  {
    name: 'semitone',
    label: 'Semitones',
    type: 'number',
    value: 0,
    defaultValue: 0,
    min: -36,
    max: 36,
    step: 1,
    unit: 'st',
  },
  {
    name: 'cents',
    label: 'Fine Tune',
    type: 'number',
    value: 0,
    defaultValue: 0,
    min: -100,
    max: 100,
    step: 1,
    unit: 'cents',
  },
];

/**
 * Lightweight pitch shifter using SoundTouch algorithm (pure JS)
 */
export class SoundTouchFilter extends BaseFilter {
  readonly name = 'soundtouch';
  readonly displayName = 'SoundTouch Pitch Shifter';
  readonly description = 'Lightweight pitch shifting (no formant preservation)';

  private workletNode: AudioWorkletNode | null = null;
  private _inputNode: GainNode | null = null;
  private _outputNode: GainNode | null = null;
  private ready: boolean = false;

  constructor() {
    super();
    for (const param of SOUNDTOUCH_PARAMETERS) {
      this.registerParameter(param);
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

  /**
   * Initialize the filter with the given audio context
   */
  async initialize(context: AudioContext): Promise<void> {
    // Guard against double initialization
    if (this._inputNode) {
      console.warn('[SoundTouchFilter] Already initialized');
      return;
    }

    this.context = context;

    // Create input/output gain nodes
    this._inputNode = context.createGain();
    this._outputNode = context.createGain();
    this.bypassGain = context.createGain();
    this.dryGain = context.createGain();

    // CRITICAL: Set dry gain to 0 IMMEDIATELY to prevent doubled audio
    // Default GainNode.gain is 1.0, which would pass audio through both paths
    this.dryGain.gain.value = 0;

    // Load the AudioWorklet module
    const workletUrl = this.getWorkletUrl();
    await context.audioWorklet.addModule(workletUrl);

    // Create the worklet node
    this.workletNode = new AudioWorkletNode(context, 'soundtouch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Set up message handling
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'ready') {
        this.ready = true;
        console.log('[SoundTouchFilter] Processor ready');
      }
    };

    // Wire up the audio graph - wet path only when not bypassed
    // Dry path is for bypass mode (original audio passthrough)
    this._inputNode.connect(this.dryGain);
    this.dryGain.connect(this._outputNode);

    this._inputNode.connect(this.workletNode);
    this.workletNode.connect(this.bypassGain);
    this.bypassGain.connect(this._outputNode);

    // Apply initial state (redundant but safe)
    this.updateBypassState();
    this.syncParameters();
  }

  /**
   * Clean up resources
   */
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

  /**
   * Get the URL for the AudioWorklet module
   * Uses the extension URL helper provided by the content script
   */
  private getWorkletUrl(): string {
    // In MAIN world, use the helper function set up by content.ts
    const getExtensionUrl = (window as any).__ups_getExtensionUrl;
    if (typeof getExtensionUrl === 'function') {
      return getExtensionUrl('worklet/soundtouch-processor.js');
    }
    // Fallback for testing outside extension context
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('worklet/soundtouch-processor.js');
    }
    return '/worklet/soundtouch-processor.js';
  }

  /**
   * Handle parameter changes
   */
  protected onParameterChanged(name: string, value: number): void {
    if (!this.workletNode) return;

    const params = this.workletNode.parameters;
    const param = params.get(name);

    if (param) {
      param.setValueAtTime(value, this.context?.currentTime ?? 0);
    }
  }

  /**
   * Sync all parameter values to worklet
   */
  private syncParameters(): void {
    for (const param of this._parameters.values()) {
      if (param.type === 'number') {
        this.onParameterChanged(param.name, param.value);
      }
    }
  }

  /**
   * Reset the processor state
   */
  reset(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
  }
}
