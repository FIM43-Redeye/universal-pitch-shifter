/**
 * Parametric EQ Filter
 *
 * 3-band parametric equalizer using native Web Audio BiquadFilterNode.
 * No WASM required - runs efficiently on any browser.
 *
 * Bands:
 * - Low shelf (adjustable frequency, gain)
 * - Mid peak (adjustable frequency, gain, Q)
 * - High shelf (adjustable frequency, gain)
 */

import { BaseFilter, FilterParameter } from '../../base';

/**
 * EQ band configuration
 */
interface EQBand {
  node: BiquadFilterNode | null;
  type: BiquadFilterType;
  frequency: number;
  gain: number;
  q: number;
}

/**
 * Default parameters for the 3-band EQ
 */
const EQ_PARAMETERS: FilterParameter[] = [
  // Low shelf
  {
    name: 'lowFreq',
    label: 'Low Freq',
    type: 'number',
    value: 200,
    defaultValue: 200,
    min: 20,
    max: 500,
    step: 10,
    unit: 'Hz',
  },
  {
    name: 'lowGain',
    label: 'Low Gain',
    type: 'number',
    value: 0,
    defaultValue: 0,
    min: -12,
    max: 12,
    step: 0.5,
    unit: 'dB',
  },
  // Mid peak
  {
    name: 'midFreq',
    label: 'Mid Freq',
    type: 'number',
    value: 1000,
    defaultValue: 1000,
    min: 200,
    max: 8000,
    step: 50,
    unit: 'Hz',
  },
  {
    name: 'midGain',
    label: 'Mid Gain',
    type: 'number',
    value: 0,
    defaultValue: 0,
    min: -12,
    max: 12,
    step: 0.5,
    unit: 'dB',
  },
  {
    name: 'midQ',
    label: 'Mid Q',
    type: 'number',
    value: 1.0,
    defaultValue: 1.0,
    min: 0.1,
    max: 10,
    step: 0.1,
    unit: '',
  },
  // High shelf
  {
    name: 'highFreq',
    label: 'High Freq',
    type: 'number',
    value: 4000,
    defaultValue: 4000,
    min: 2000,
    max: 16000,
    step: 100,
    unit: 'Hz',
  },
  {
    name: 'highGain',
    label: 'High Gain',
    type: 'number',
    value: 0,
    defaultValue: 0,
    min: -12,
    max: 12,
    step: 0.5,
    unit: 'dB',
  },
];

/**
 * 3-band Parametric EQ using native BiquadFilterNode
 */
export class ParametricEQFilter extends BaseFilter {
  readonly name = 'parametric-eq';
  readonly displayName = 'Parametric EQ';
  readonly description = '3-band equalizer (low shelf, mid peak, high shelf)';

  private _inputNode: GainNode | null = null;
  private _outputNode: GainNode | null = null;

  private lowBand: EQBand = { node: null, type: 'lowshelf', frequency: 200, gain: 0, q: 1 };
  private midBand: EQBand = { node: null, type: 'peaking', frequency: 1000, gain: 0, q: 1 };
  private highBand: EQBand = { node: null, type: 'highshelf', frequency: 4000, gain: 0, q: 1 };

  constructor() {
    super();
    for (const param of EQ_PARAMETERS) {
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
      console.warn('[ParametricEQFilter] Already initialized');
      return;
    }

    this.context = context;

    // Create input/output and bypass nodes
    this._inputNode = context.createGain();
    this._outputNode = context.createGain();
    this.bypassGain = context.createGain();
    this.dryGain = context.createGain();

    // Set dry gain to 0 to prevent doubled audio
    this.dryGain.gain.value = 0;

    // Create EQ band nodes
    this.lowBand.node = context.createBiquadFilter();
    this.lowBand.node.type = 'lowshelf';
    this.lowBand.node.frequency.value = this.lowBand.frequency;
    this.lowBand.node.gain.value = this.lowBand.gain;

    this.midBand.node = context.createBiquadFilter();
    this.midBand.node.type = 'peaking';
    this.midBand.node.frequency.value = this.midBand.frequency;
    this.midBand.node.gain.value = this.midBand.gain;
    this.midBand.node.Q.value = this.midBand.q;

    this.highBand.node = context.createBiquadFilter();
    this.highBand.node.type = 'highshelf';
    this.highBand.node.frequency.value = this.highBand.frequency;
    this.highBand.node.gain.value = this.highBand.gain;

    // Wire up: input -> low -> mid -> high -> bypassGain -> output
    this._inputNode.connect(this.dryGain);
    this.dryGain.connect(this._outputNode);

    this._inputNode.connect(this.lowBand.node);
    this.lowBand.node.connect(this.midBand.node);
    this.midBand.node.connect(this.highBand.node);
    this.highBand.node.connect(this.bypassGain);
    this.bypassGain.connect(this._outputNode);

    // Apply initial state
    this.updateBypassState();
    this.syncParameters();
  }

  dispose(): void {
    this.lowBand.node?.disconnect();
    this.midBand.node?.disconnect();
    this.highBand.node?.disconnect();
    this.lowBand.node = null;
    this.midBand.node = null;
    this.highBand.node = null;
    this._inputNode?.disconnect();
    this._outputNode?.disconnect();
    this._inputNode = null;
    this._outputNode = null;
    super.dispose();
  }

  protected onParameterChanged(name: string, value: number): void {
    if (!this.context) return;

    const time = this.context.currentTime;

    switch (name) {
      // Low shelf
      case 'lowFreq':
        this.lowBand.frequency = value;
        this.lowBand.node?.frequency.setValueAtTime(value, time);
        break;
      case 'lowGain':
        this.lowBand.gain = value;
        this.lowBand.node?.gain.setValueAtTime(value, time);
        break;

      // Mid peak
      case 'midFreq':
        this.midBand.frequency = value;
        this.midBand.node?.frequency.setValueAtTime(value, time);
        break;
      case 'midGain':
        this.midBand.gain = value;
        this.midBand.node?.gain.setValueAtTime(value, time);
        break;
      case 'midQ':
        this.midBand.q = value;
        this.midBand.node?.Q.setValueAtTime(value, time);
        break;

      // High shelf
      case 'highFreq':
        this.highBand.frequency = value;
        this.highBand.node?.frequency.setValueAtTime(value, time);
        break;
      case 'highGain':
        this.highBand.gain = value;
        this.highBand.node?.gain.setValueAtTime(value, time);
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
