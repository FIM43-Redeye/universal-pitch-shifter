/**
 * Dynamics Compressor Filter
 *
 * Dynamic range compressor using native Web Audio DynamicsCompressorNode.
 * No WASM required - runs efficiently on any browser.
 *
 * Parameters expose the full DynamicsCompressorNode API:
 * - Threshold: Level above which compression begins (-100 to 0 dB)
 * - Knee: Range over which compression curve transitions (0 to 40 dB)
 * - Ratio: Amount of compression (1:1 to 20:1)
 * - Attack: Time to apply full compression (0 to 1 seconds)
 * - Release: Time to release compression (0 to 1 seconds)
 *
 * Also provides makeup gain to compensate for compression.
 */

import { BaseFilter, FilterParameter } from '../../base';

/**
 * Default parameters for the compressor
 * These are sensible defaults for gentle compression
 */
const COMPRESSOR_PARAMETERS: FilterParameter[] = [
  {
    name: 'threshold',
    label: 'Threshold',
    type: 'number',
    value: -24,
    defaultValue: -24,
    min: -100,
    max: 0,
    step: 1,
    unit: 'dB',
    description: 'Level above which compression begins',
  },
  {
    name: 'knee',
    label: 'Knee',
    type: 'number',
    value: 30,
    defaultValue: 30,
    min: 0,
    max: 40,
    step: 1,
    unit: 'dB',
    description: 'Transition range for compression curve (soft/hard knee)',
  },
  {
    name: 'ratio',
    label: 'Ratio',
    type: 'number',
    value: 4,
    defaultValue: 4,
    min: 1,
    max: 20,
    step: 0.5,
    unit: ':1',
    description: 'Compression ratio (e.g., 4:1 means 4dB over threshold becomes 1dB)',
  },
  {
    name: 'attack',
    label: 'Attack',
    type: 'number',
    value: 0.003,
    defaultValue: 0.003,
    min: 0,
    max: 1,
    step: 0.001,
    unit: 's',
    description: 'Time to reach full compression after signal exceeds threshold',
  },
  {
    name: 'release',
    label: 'Release',
    type: 'number',
    value: 0.25,
    defaultValue: 0.25,
    min: 0,
    max: 1,
    step: 0.01,
    unit: 's',
    description: 'Time to release compression after signal falls below threshold',
  },
  {
    name: 'makeupGain',
    label: 'Makeup Gain',
    type: 'number',
    value: 0,
    defaultValue: 0,
    min: 0,
    max: 24,
    step: 0.5,
    unit: 'dB',
    description: 'Gain applied after compression to restore perceived loudness',
  },
];

/**
 * Dynamics Compressor using native DynamicsCompressorNode
 */
export class CompressorFilter extends BaseFilter {
  readonly name = 'compressor';
  readonly displayName = 'Compressor';
  readonly description = 'Dynamic range compressor with threshold, ratio, and makeup gain';

  private _inputNode: GainNode | null = null;
  private _outputNode: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private makeupGainNode: GainNode | null = null;

  constructor() {
    super();
    for (const param of COMPRESSOR_PARAMETERS) {
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

  async initialize(context: AudioContext): Promise<void> {
    if (this._inputNode) {
      console.warn('[CompressorFilter] Already initialized');
      return;
    }

    this.context = context;

    // Create input/output and bypass nodes
    this._inputNode = context.createGain();
    this._outputNode = context.createGain();
    this.bypassGain = context.createGain();
    this.dryGain = context.createGain();
    this.dryGain.gain.value = 0;

    // Create compressor
    this.compressor = context.createDynamicsCompressor();

    // Create makeup gain (applied after compression)
    this.makeupGainNode = context.createGain();

    // Wire up: input -> compressor -> makeupGain -> bypassGain -> output
    // Also:    input -> dryGain -> output (for bypass)
    this._inputNode.connect(this.dryGain);
    this.dryGain.connect(this._outputNode);

    this._inputNode.connect(this.compressor);
    this.compressor.connect(this.makeupGainNode);
    this.makeupGainNode.connect(this.bypassGain);
    this.bypassGain.connect(this._outputNode);

    // Apply initial state
    this.updateBypassState();
    this.syncParameters();
  }

  dispose(): void {
    this.compressor?.disconnect();
    this.compressor = null;
    this.makeupGainNode?.disconnect();
    this.makeupGainNode = null;
    this._inputNode?.disconnect();
    this._inputNode = null;
    this._outputNode?.disconnect();
    this._outputNode = null;
    super.dispose();
  }

  /**
   * Get the current gain reduction in dB.
   * Useful for metering - shows how much compression is being applied.
   */
  getReduction(): number {
    return this.compressor?.reduction ?? 0;
  }

  protected onParameterChanged(name: string, value: number): void {
    if (!this.context) return;

    const time = this.context.currentTime;

    switch (name) {
      case 'threshold':
        this.compressor?.threshold.setValueAtTime(value, time);
        break;
      case 'knee':
        this.compressor?.knee.setValueAtTime(value, time);
        break;
      case 'ratio':
        this.compressor?.ratio.setValueAtTime(value, time);
        break;
      case 'attack':
        this.compressor?.attack.setValueAtTime(value, time);
        break;
      case 'release':
        this.compressor?.release.setValueAtTime(value, time);
        break;
      case 'makeupGain':
        // Convert dB to linear gain
        const linearGain = Math.pow(10, value / 20);
        this.makeupGainNode?.gain.setValueAtTime(linearGain, time);
        break;
    }
  }

  private syncParameters(): void {
    for (const param of this._parameters.values()) {
      if (param.type === 'number') {
        this.onParameterChanged(param.name, param.value);
      }
    }
  }
}
