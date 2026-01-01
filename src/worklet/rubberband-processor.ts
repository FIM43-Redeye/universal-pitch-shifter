/// <reference path="./worklet-types.d.ts" />
/**
 * RubberBand AudioWorklet Processor
 *
 * Runs in the AudioWorklet context and uses RubberBand WASM for
 * high-quality pitch shifting with formant preservation.
 *
 * This processor accepts ALL RubberBand options via processorOptions,
 * matching the filter's data-driven parameter system. Options that can
 * be changed at runtime use setter functions; others require rebuilding
 * the stretcher.
 *
 * GPL-2.0 License (required by RubberBand)
 */

// Processing constants
const BLOCK_SIZE = 128; // AudioWorklet quantum size
const FADE_FRAMES = 64; // Frames for crossfade when bypassing

/**
 * Interface for RubberBand WASM module.
 * Includes all functions we might call, including runtime option setters.
 */
interface RubberbandWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Core stretcher lifecycle
  _rubberband_new(
    sampleRate: number,
    channels: number,
    options: number,
    initialTimeRatio: number,
    initialPitchScale: number
  ): number;
  _rubberband_delete(state: number): void;
  _rubberband_reset(state: number): void;

  // Continuous parameters (always available)
  _rubberband_set_pitch_scale(state: number, scale: number): void;
  _rubberband_get_pitch_scale(state: number): number;
  _rubberband_set_formant_scale(state: number, scale: number): void;
  _rubberband_get_formant_scale(state: number): number;

  // Runtime option setters (R2 engine only for some)
  _rubberband_set_transients_option(state: number, option: number): void;
  _rubberband_set_detector_option(state: number, option: number): void;
  _rubberband_set_phase_option(state: number, option: number): void;
  _rubberband_set_formant_option(state: number, option: number): void;
  _rubberband_set_pitch_option(state: number, option: number): void;

  // Processing configuration
  _rubberband_get_latency(state: number): number;
  _rubberband_set_max_process_size(state: number, samples: number): void;
  _rubberband_set_expected_input_duration(state: number, samples: number): void;

  // Audio processing
  _rubberband_process(
    state: number,
    input: number,
    samples: number,
    isFinal: number
  ): void;
  _rubberband_available(state: number): number;
  _rubberband_retrieve(state: number, output: number, samples: number): number;

  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
  memory: WebAssembly.Memory;
}

/**
 * RubberBand pitch shifting processor for AudioWorklet
 */
class RubberbandProcessor extends AudioWorkletProcessor {
  /**
   * AudioParam descriptors for sample-accurate automation.
   * The filter converts semitones/cents to pitchScale before sending here.
   */
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      {
        name: 'pitchScale',
        defaultValue: 1.0,
        minValue: 0.25,  // -24 semitones
        maxValue: 4.0,   // +24 semitones
        automationRate: 'k-rate',
      },
      {
        name: 'formantScale',
        defaultValue: 1.0,
        minValue: 0.5,
        maxValue: 2.0,
        automationRate: 'k-rate',
      },
      {
        name: 'enabled',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  private wasm: RubberbandWasm | null = null;
  private stretcher: number = 0;
  private channels: number;
  private ready: boolean = false;
  private bypassed: boolean = true;

  // Current options bitmask - rebuilt when options change
  private currentOptions: number;

  // Memory pointers for WASM
  private inputBufferPtrs: number[] = [];
  private outputBufferPtrs: number[] = [];
  private inputArrayPtr: number = 0;
  private outputArrayPtr: number = 0;

  // State for smooth transitions
  private previousPitchScale: number = 1.0;
  private previousFormantScale: number = 1.0;
  private fadeCounter: number = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super();

    // Default to stereo
    this.channels = options?.outputChannelCount?.[0] ?? 2;
    this.channels = Math.min(2, Math.max(1, this.channels));

    // Handle messages from main thread
    this.port.onmessage = this.handleMessage.bind(this);

    // Get processor options
    const processorOptions = options?.processorOptions as {
      wasmBytes?: ArrayBuffer;
      initialOptions?: number;
    };

    // Store initial options (filter builds the bitmask from its option groups)
    // If not provided, use a sensible default for real-time processing
    this.currentOptions = processorOptions?.initialOptions ?? 0x23010001;

    if (processorOptions?.wasmBytes) {
      this.initializeWasm(processorOptions.wasmBytes);
    } else {
      this.port.postMessage({ type: 'error', message: 'No WASM bytes provided' });
    }
  }

  /**
   * Initialize the RubberBand WASM module
   */
  private async initializeWasm(wasmBytes: ArrayBuffer): Promise<void> {
    try {
      // Instantiate WASM module
      const wasmModule = await WebAssembly.compile(wasmBytes);
      const wasmInstance = await WebAssembly.instantiate(wasmModule, {
        env: {
          // Minimal environment - RubberBand with NO_EXCEPTIONS doesn't need much
          abort: () => {
            console.error('[RubberbandProcessor] WASM abort called');
          },
        },
        wasi_snapshot_preview1: {
          // Empty WASI stubs if needed
          fd_write: () => 0,
          fd_close: () => 0,
          fd_seek: () => 0,
          proc_exit: () => {},
        },
      });

      // Get exports
      const exports = wasmInstance.exports as unknown as RubberbandWasm;
      this.wasm = {
        ...exports,
        memory: exports.memory as WebAssembly.Memory,
        HEAPF32: new Float32Array((exports.memory as WebAssembly.Memory).buffer),
        HEAPU32: new Uint32Array((exports.memory as WebAssembly.Memory).buffer),
      };

      // Allocate buffers
      this.allocateBuffers();

      // Create stretcher instance
      this.createStretcher();

      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      console.error('[RubberbandProcessor] WASM initialization failed:', error);
      this.port.postMessage({
        type: 'error',
        message: `WASM init failed: ${error}`,
      });
    }
  }

  /**
   * Allocate WASM memory for audio buffers
   */
  private allocateBuffers(): void {
    if (!this.wasm) return;

    // Allocate input/output buffers for each channel
    // Each buffer holds BLOCK_SIZE float32 samples (4 bytes each)
    const bufferSize = BLOCK_SIZE * 4;

    for (let ch = 0; ch < this.channels; ch++) {
      this.inputBufferPtrs.push(this.wasm._malloc(bufferSize));
      this.outputBufferPtrs.push(this.wasm._malloc(bufferSize));
    }

    // Allocate pointer arrays (array of pointers to buffers)
    // Each pointer is 4 bytes
    this.inputArrayPtr = this.wasm._malloc(this.channels * 4);
    this.outputArrayPtr = this.wasm._malloc(this.channels * 4);

    // Store buffer pointers in the pointer arrays
    for (let ch = 0; ch < this.channels; ch++) {
      this.wasm.HEAPU32[this.inputArrayPtr / 4 + ch] = this.inputBufferPtrs[ch];
      this.wasm.HEAPU32[this.outputArrayPtr / 4 + ch] = this.outputBufferPtrs[ch];
    }
  }

  /**
   * Create a new RubberBand stretcher instance with current options.
   * Called at initialization and when options requiring rebuild change.
   */
  private createStretcher(options?: number): void {
    if (!this.wasm) return;

    // Use provided options or current options
    if (options !== undefined) {
      this.currentOptions = options;
    }

    // Delete existing stretcher if any
    if (this.stretcher) {
      this.wasm._rubberband_delete(this.stretcher);
    }

    // Create new stretcher with current options
    this.stretcher = this.wasm._rubberband_new(
      sampleRate, // Global in AudioWorklet
      this.channels,
      this.currentOptions,
      1.0, // Initial time ratio
      1.0  // Initial pitch scale
    );

    if (!this.stretcher) {
      console.error('[RubberbandProcessor] Failed to create stretcher');
      return;
    }

    // Configure for real-time processing
    this.wasm._rubberband_set_max_process_size(this.stretcher, BLOCK_SIZE);
    this.wasm._rubberband_set_expected_input_duration(this.stretcher, BLOCK_SIZE);

    // Apply current pitch/formant scales (in case we're rebuilding mid-stream)
    this.wasm._rubberband_set_pitch_scale(this.stretcher, this.previousPitchScale);
    this.wasm._rubberband_set_formant_scale(this.stretcher, this.previousFormantScale);

    // Reset fade state
    this.fadeCounter = FADE_FRAMES;
  }

  /**
   * Handle messages from the main thread.
   *
   * Message types:
   * - reset: Clear internal buffers
   * - setOption: Change an option at runtime via its setter function
   * - rebuildStretcher: Recreate stretcher with new options bitmask
   */
  private handleMessage(event: MessageEvent): void {
    const { type } = event.data;

    switch (type) {
      case 'reset':
        if (this.wasm && this.stretcher) {
          this.wasm._rubberband_reset(this.stretcher);
        }
        this.bypassed = true;
        break;

      case 'setOption': {
        // Runtime option change via specific setter function
        // e.g., { type: 'setOption', setter: '_rubberband_set_formant_option', value: 16777216 }
        if (!this.wasm || !this.stretcher) break;

        const { setter, value } = event.data as { setter: string; value: number };
        const setterFn = (this.wasm as unknown as Record<string, Function>)[setter];

        if (typeof setterFn === 'function') {
          setterFn.call(this.wasm, this.stretcher, value);
        } else {
          console.warn(`[RubberbandProcessor] Unknown setter: ${setter}`);
        }
        break;
      }

      case 'rebuildStretcher': {
        // Option change that requires recreating the stretcher
        // e.g., { type: 'rebuildStretcher', options: 0x23010001 }
        const { options } = event.data as { options: number };
        this.createStretcher(options);
        break;
      }
    }
  }

  /**
   * Process audio through RubberBand.
   * Parameters are already in their final form (filter does conversions).
   */
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];

    // Early exit if no input or output
    if (!input?.[0] || !output?.[0]) {
      return true;
    }

    const numSamples = input[0].length;

    // Get parameter values (k-rate = single value per block)
    // Filter already converts semitones/cents to pitchScale
    const pitchScale = parameters.pitchScale[0];
    const formantScale = parameters.formantScale[0];
    const enabled = parameters.enabled[0] >= 0.5;

    // Check if we should bypass (no pitch change and not enabled)
    const shouldBypass = !enabled || Math.abs(pitchScale - 1.0) < 0.001;

    // Handle bypass transitions
    if (shouldBypass && !this.bypassed) {
      // Transitioning to bypass - start fade out
      this.fadeCounter = FADE_FRAMES;
      this.bypassed = true;
    } else if (!shouldBypass && this.bypassed) {
      // Transitioning from bypass - start fade in
      this.fadeCounter = FADE_FRAMES;
      this.bypassed = false;
    }

    // If not ready or fully bypassed with no fade, just pass through
    if (!this.ready || !this.wasm || !this.stretcher) {
      this.passthrough(input, output);
      return true;
    }

    if (this.bypassed && this.fadeCounter <= 0) {
      this.passthrough(input, output);
      return true;
    }

    // Update pitch scale if changed
    if (Math.abs(pitchScale - this.previousPitchScale) > 0.001) {
      this.wasm._rubberband_set_pitch_scale(this.stretcher, pitchScale);
      this.previousPitchScale = pitchScale;
    }

    // Update formant scale if changed
    if (Math.abs(formantScale - this.previousFormantScale) > 0.001) {
      this.wasm._rubberband_set_formant_scale(this.stretcher, formantScale);
      this.previousFormantScale = formantScale;
    }

    // Refresh heap views in case memory grew
    this.wasm.HEAPF32 = new Float32Array(this.wasm.memory.buffer);

    // Copy input to WASM buffers
    for (let ch = 0; ch < this.channels && ch < input.length; ch++) {
      this.wasm.HEAPF32.set(input[ch], this.inputBufferPtrs[ch] / 4);
    }
    // If mono input but stereo processing, duplicate
    if (input.length === 1 && this.channels === 2) {
      this.wasm.HEAPF32.set(input[0], this.inputBufferPtrs[1] / 4);
    }

    // Process through RubberBand
    this.wasm._rubberband_process(
      this.stretcher,
      this.inputArrayPtr,
      numSamples,
      0 // Not final
    );

    // Check if output is available
    const available = this.wasm._rubberband_available(this.stretcher);

    if (available >= numSamples) {
      // Retrieve processed audio
      this.wasm._rubberband_retrieve(
        this.stretcher,
        this.outputArrayPtr,
        numSamples
      );

      // Copy from WASM buffers to output
      for (let ch = 0; ch < output.length; ch++) {
        const sourceChannel = Math.min(ch, this.channels - 1);
        const processedData = new Float32Array(
          this.wasm.memory.buffer,
          this.outputBufferPtrs[sourceChannel],
          numSamples
        );

        // Apply crossfade if transitioning
        if (this.fadeCounter > 0) {
          this.applyCrossfade(input[ch] || input[0], processedData, output[ch]);
          this.fadeCounter--;
        } else {
          output[ch].set(processedData);
        }
      }
    } else {
      // Not enough output yet - pass through input
      this.passthrough(input, output);
    }

    return true;
  }

  /**
   * Simple passthrough - copy input to output
   */
  private passthrough(input: Float32Array[], output: Float32Array[]): void {
    for (let ch = 0; ch < output.length; ch++) {
      const source = input[ch] || input[0];
      output[ch].set(source);
    }
  }

  /**
   * Apply crossfade between dry and wet signals
   */
  private applyCrossfade(
    dry: Float32Array,
    wet: Float32Array,
    output: Float32Array
  ): void {
    const fadeProgress = 1 - this.fadeCounter / FADE_FRAMES;
    // Use sine curve for smooth crossfade
    const wetGain = this.bypassed
      ? Math.cos(fadeProgress * Math.PI * 0.5)
      : Math.sin(fadeProgress * Math.PI * 0.5);
    const dryGain = this.bypassed
      ? Math.sin(fadeProgress * Math.PI * 0.5)
      : Math.cos(fadeProgress * Math.PI * 0.5);

    for (let i = 0; i < output.length; i++) {
      output[i] = dry[i] * dryGain + wet[i] * wetGain;
    }
  }
}

// Register the processor
registerProcessor('rubberband-processor', RubberbandProcessor);
