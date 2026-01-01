/**
 * Delay Filter
 *
 * Time-based delay/echo effect using native Web Audio DelayNode.
 * No WASM required - runs efficiently on any browser.
 *
 * Parameters:
 * - Delay Time: Time between echoes (0 to 2 seconds)
 * - Feedback: Amount of signal fed back into delay (0 to 0.95)
 * - Mix: Wet/dry balance (0 = dry, 1 = wet)
 *
 * Audio routing:
 * input -> dryGain ------> mixer -> output
 *       -> delayNode -> feedbackGain -> wetGain -> mixer
 *             ^--<--<--<--<--|
 */

import { BaseFilter, FilterParameter } from '../../base';

/**
 * Default parameters for the delay
 */
const DELAY_PARAMETERS: FilterParameter[] = [
  {
    name: 'delayTime',
    label: 'Delay Time',
    type: 'number',
    value: 0.25,
    defaultValue: 0.25,
    min: 0.01,
    max: 2.0,
    step: 0.01,
    unit: 's',
    description: 'Time between echoes',
  },
  {
    name: 'feedback',
    label: 'Feedback',
    type: 'number',
    value: 0.3,
    defaultValue: 0.3,
    min: 0,
    max: 0.95,
    step: 0.01,
    unit: '',
    description: 'Amount of delayed signal fed back (higher = more echoes)',
  },
  {
    name: 'mix',
    label: 'Mix',
    type: 'number',
    value: 0.5,
    defaultValue: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    description: 'Blend between dry (0) and wet (1) signal',
  },
];

/**
 * Delay/Echo effect using native DelayNode
 */
export class DelayFilter extends BaseFilter {
  readonly name = 'delay';
  readonly displayName = 'Delay';
  readonly description = 'Echo/delay effect with feedback and mix controls';

  private _inputNode: GainNode | null = null;
  private _outputNode: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private feedbackGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private effectDryGain: GainNode | null = null;

  constructor() {
    super();
    for (const param of DELAY_PARAMETERS) {
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
      console.warn('[DelayFilter] Already initialized');
      return;
    }

    this.context = context;

    // Create input/output and bypass nodes
    this._inputNode = context.createGain();
    this._outputNode = context.createGain();
    this.bypassGain = context.createGain();
    this.dryGain = context.createGain();
    this.dryGain.gain.value = 0;

    // Create delay components
    this.delayNode = context.createDelay(2.0); // Max 2 seconds
    this.feedbackGain = context.createGain();
    this.wetGain = context.createGain();
    this.effectDryGain = context.createGain();

    // Wire up bypass path
    this._inputNode.connect(this.dryGain);
    this.dryGain.connect(this._outputNode);

    // Wire up effect path:
    // input -> effectDryGain -> bypassGain (dry component of effect)
    // input -> delay -> feedbackGain -> wetGain -> bypassGain (wet component)
    //            ^--<--<--<--<--|
    this._inputNode.connect(this.effectDryGain);
    this.effectDryGain.connect(this.bypassGain);

    this._inputNode.connect(this.delayNode);
    this.delayNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode); // Feedback loop
    this.feedbackGain.connect(this.wetGain);
    this.wetGain.connect(this.bypassGain);

    this.bypassGain.connect(this._outputNode);

    // Apply initial state
    this.updateBypassState();
    this.syncParameters();
  }

  dispose(): void {
    this.delayNode?.disconnect();
    this.delayNode = null;
    this.feedbackGain?.disconnect();
    this.feedbackGain = null;
    this.wetGain?.disconnect();
    this.wetGain = null;
    this.effectDryGain?.disconnect();
    this.effectDryGain = null;
    this._inputNode?.disconnect();
    this._inputNode = null;
    this._outputNode?.disconnect();
    this._outputNode = null;
    super.dispose();
  }

  protected onParameterChanged(name: string, value: number): void {
    if (!this.context) return;

    const time = this.context.currentTime;

    switch (name) {
      case 'delayTime':
        this.delayNode?.delayTime.setValueAtTime(value, time);
        break;
      case 'feedback':
        this.feedbackGain?.gain.setValueAtTime(value, time);
        break;
      case 'mix':
        // Mix: 0 = full dry, 1 = full wet
        // Use equal-power crossfade for natural blending
        const dryLevel = Math.cos(value * Math.PI / 2);
        const wetLevel = Math.sin(value * Math.PI / 2);
        this.effectDryGain?.gain.setValueAtTime(dryLevel, time);
        this.wetGain?.gain.setValueAtTime(wetLevel, time);
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
