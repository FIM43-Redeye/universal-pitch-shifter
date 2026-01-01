/// <reference path="./worklet-types.d.ts" />
/**
 * SoundTouch AudioWorklet Processor
 *
 * Pure JavaScript implementation for pitch shifting.
 * Lighter weight than RubberBand, good fallback option.
 *
 * Uses WSOLA (Waveform Similarity Overlap-Add) algorithm.
 */

// Import will be bundled by Vite - we inline the essential classes here
// to avoid module loading issues in the AudioWorklet context

// ============================================================================
// Inline SoundTouch implementation for AudioWorklet
// ============================================================================

/**
 * Circular buffer for audio samples (interleaved stereo)
 */
class FifoBuffer {
  private _vector: Float32Array;
  private _position: number = 0;
  private _frameCount: number = 0;

  constructor(initialCapacity: number = 4096) {
    this._vector = new Float32Array(initialCapacity * 2);
  }

  get position(): number { return this._position; }
  get frameCount(): number { return this._frameCount; }
  get startIndex(): number { return this._position * 2; }
  get endIndex(): number { return (this._position + this._frameCount) * 2; }
  get vector(): Float32Array { return this._vector; }

  clear(): void {
    this.receive(this._frameCount);
    this.rewind();
  }

  put(numFrames: number): void {
    this._frameCount += numFrames;
  }

  putSamples(samples: Float32Array, offset: number = 0, numFrames?: number): void {
    const sourceStart = offset * 2;
    if (numFrames === undefined) {
      numFrames = (samples.length - sourceStart) / 2;
    }
    this.ensureCapacity(this._frameCount + numFrames);
    const destStart = this.endIndex;
    const count = numFrames * 2;
    this._vector.set(samples.subarray(sourceStart, sourceStart + count), destStart);
    this._frameCount += numFrames;
  }

  putBuffer(buffer: FifoBuffer, offset: number = 0, numFrames?: number): void {
    if (numFrames === undefined) {
      numFrames = buffer.frameCount - offset;
    }
    this.putSamples(buffer.vector, buffer.position + offset, numFrames);
  }

  receive(numFrames: number): void {
    if (numFrames < 0 || numFrames > this._frameCount) {
      numFrames = this._frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  }

  receiveSamples(output: Float32Array, numFrames: number): void {
    const count = numFrames * 2;
    const start = this.startIndex;
    output.set(this._vector.subarray(start, start + count));
    this.receive(numFrames);
  }

  extract(output: Float32Array, offset: number, numFrames: number): void {
    const start = this.startIndex + offset * 2;
    const count = numFrames * 2;
    output.set(this._vector.subarray(start, start + count));
  }

  ensureCapacity(numFrames: number): void {
    const requiredSize = numFrames * 2;
    if (this._vector.length < requiredSize) {
      const newVector = new Float32Array(requiredSize);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._position = 0;
    } else {
      this.rewind();
    }
  }

  rewind(): void {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
}

/**
 * Rate transposer using linear interpolation
 */
class RateTransposer {
  private _rate: number = 1.0;
  private slopeCount: number = 0;
  private prevSampleL: number = 0;
  private prevSampleR: number = 0;

  inputBuffer: FifoBuffer;
  outputBuffer: FifoBuffer;

  constructor() {
    this.inputBuffer = new FifoBuffer();
    this.outputBuffer = new FifoBuffer();
  }

  set rate(value: number) { this._rate = value; }
  get rate(): number { return this._rate; }

  reset(): void {
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  process(): void {
    const numFrames = this.inputBuffer.frameCount;
    if (numFrames === 0) return;

    this.outputBuffer.ensureCapacity(
      this.outputBuffer.frameCount + Math.ceil(numFrames / this._rate) + 1
    );

    const outputCount = this.transpose(numFrames);
    this.inputBuffer.receive(numFrames);
    this.outputBuffer.put(outputCount);
  }

  private transpose(numFrames: number): number {
    if (numFrames === 0) return 0;

    const input = this.inputBuffer.vector;
    const inputStart = this.inputBuffer.startIndex;
    const output = this.outputBuffer.vector;
    const outputStart = this.outputBuffer.endIndex;

    let outputCount = 0;
    let inputIndex = 0;

    while (this.slopeCount < 1.0) {
      const weight = this.slopeCount;
      output[outputStart + outputCount * 2] =
        (1 - weight) * this.prevSampleL + weight * input[inputStart];
      output[outputStart + outputCount * 2 + 1] =
        (1 - weight) * this.prevSampleR + weight * input[inputStart + 1];
      outputCount++;
      this.slopeCount += this._rate;
    }
    this.slopeCount -= 1.0;

    if (numFrames > 1) {
      while (true) {
        while (this.slopeCount >= 1.0) {
          this.slopeCount -= 1.0;
          inputIndex++;
          if (inputIndex >= numFrames - 1) break;
        }
        if (inputIndex >= numFrames - 1) break;

        const idx = inputStart + inputIndex * 2;
        const weight = this.slopeCount;
        output[outputStart + outputCount * 2] =
          (1 - weight) * input[idx] + weight * input[idx + 2];
        output[outputStart + outputCount * 2 + 1] =
          (1 - weight) * input[idx + 1] + weight * input[idx + 3];
        outputCount++;
        this.slopeCount += this._rate;
      }
    }

    this.prevSampleL = input[inputStart + (numFrames - 1) * 2];
    this.prevSampleR = input[inputStart + (numFrames - 1) * 2 + 1];

    return outputCount;
  }
}

/**
 * Time stretch using WSOLA algorithm
 */
class TimeStretch {
  private _sampleRate: number = 44100;
  private _tempo: number = 1.0;

  private sequenceLength: number = 0;
  private seekLength: number = 0;
  private overlapLength: number = 0;

  private nominalSkip: number = 0;
  private skipFract: number = 0;
  private midBuffer: Float32Array | null = null;
  private refMidBuffer: Float32Array | null = null;
  private sampleReq: number = 0;

  private static readonly SCAN_OFFSETS: number[][] = [
    [124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0],
    [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];

  inputBuffer: FifoBuffer;
  outputBuffer: FifoBuffer;

  constructor() {
    this.inputBuffer = new FifoBuffer();
    this.outputBuffer = new FifoBuffer();
  }

  setParameters(sampleRate: number, overlapMs: number = 16): void {
    if (sampleRate > 0) this._sampleRate = sampleRate;
    this.calculateEffectiveParams();
    this.calculateOverlapLength(overlapMs);
    this.tempo = this._tempo;
  }

  set tempo(value: number) {
    this._tempo = value;
    this.calculateEffectiveParams();
    this.nominalSkip = this._tempo * (this.sequenceLength - this.overlapLength);
    this.skipFract = 0;
    const skip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(skip + this.overlapLength, this.sequenceLength) + this.seekLength;
  }

  get tempo(): number { return this._tempo; }

  reset(): void {
    this.midBuffer = null;
    this.skipFract = 0;
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  private calculateEffectiveParams(): void {
    // Auto sequence length based on tempo
    const seqMs = 125 - (125 - 50) / (2 - 0.5) * (this._tempo - 0.5);
    this.sequenceLength = Math.floor(
      this._sampleRate * Math.max(50, Math.min(125, seqMs)) / 1000
    );

    // Auto seek window
    const seekMs = 25 - (25 - 15) / (2 - 0.5) * (this._tempo - 0.5);
    this.seekLength = Math.floor(
      this._sampleRate * Math.max(15, Math.min(25, seekMs)) / 1000
    );
  }

  private calculateOverlapLength(overlapMs: number): void {
    let overlap = Math.floor(this._sampleRate * overlapMs / 1000);
    if (overlap < 16) overlap = 16;
    overlap -= overlap % 8;
    this.overlapLength = overlap;
    this.refMidBuffer = new Float32Array(overlap * 2);
    this.midBuffer = new Float32Array(overlap * 2);
  }

  private seekBestOverlapPosition(): number {
    this.precalcCorrReference();
    return this.seekBestOverlapPositionQuick();
  }

  private seekBestOverlapPositionQuick(): number {
    let bestOffset = 0;
    let bestCorr = Number.MIN_VALUE;
    let corrOffset = 0;

    for (let scanLevel = 0; scanLevel < 4; scanLevel++) {
      let scanCount = 0;
      while (TimeStretch.SCAN_OFFSETS[scanLevel][scanCount]) {
        const testOffset = corrOffset + TimeStretch.SCAN_OFFSETS[scanLevel][scanCount];
        if (testOffset >= 0 && testOffset < this.seekLength) {
          const corr = this.calculateCrossCorr(testOffset * 2);
          if (corr > bestCorr) {
            bestCorr = corr;
            bestOffset = testOffset;
          }
        }
        scanCount++;
      }
      corrOffset = bestOffset;
    }
    return bestOffset;
  }

  private precalcCorrReference(): void {
    for (let i = 0; i < this.overlapLength; i++) {
      const weight = i * (this.overlapLength - i);
      const idx = i * 2;
      this.refMidBuffer![idx] = this.midBuffer![idx] * weight;
      this.refMidBuffer![idx + 1] = this.midBuffer![idx + 1] * weight;
    }
  }

  private calculateCrossCorr(offset: number): number {
    const input = this.inputBuffer.vector;
    const inputStart = this.inputBuffer.startIndex + offset;
    let corr = 0;

    for (let i = 2; i < this.overlapLength * 2; i += 2) {
      corr +=
        input[inputStart + i] * this.refMidBuffer![i] +
        input[inputStart + i + 1] * this.refMidBuffer![i + 1];
    }
    return corr;
  }

  private overlap(offset: number): void {
    const input = this.inputBuffer.vector;
    const inputStart = this.inputBuffer.startIndex + offset * 2;
    const output = this.outputBuffer.vector;
    const outputStart = this.outputBuffer.endIndex;
    const invOverlap = 1.0 / this.overlapLength;

    for (let i = 0; i < this.overlapLength; i++) {
      const fadeOut = (this.overlapLength - i) * invOverlap;
      const fadeIn = i * invOverlap;
      const idx = i * 2;
      const inIdx = inputStart + idx;
      const outIdx = outputStart + idx;

      output[outIdx] = input[inIdx] * fadeIn + this.midBuffer![idx] * fadeOut;
      output[outIdx + 1] = input[inIdx + 1] * fadeIn + this.midBuffer![idx + 1] * fadeOut;
    }
  }

  process(): void {
    if (this.midBuffer === null || this.midBuffer.length === 0) {
      if (this.inputBuffer.frameCount < this.overlapLength) return;
      this.midBuffer = new Float32Array(this.overlapLength * 2);
      this.inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
    }

    while (this.inputBuffer.frameCount >= this.sampleReq) {
      const offset = this.seekBestOverlapPosition();

      this.outputBuffer.ensureCapacity(this.outputBuffer.frameCount + this.overlapLength);
      this.overlap(offset);
      this.outputBuffer.put(this.overlapLength);

      const middleLength = this.sequenceLength - 2 * this.overlapLength;
      if (middleLength > 0) {
        this.outputBuffer.putBuffer(this.inputBuffer, offset + this.overlapLength, middleLength);
      }

      const midStart = this.inputBuffer.startIndex +
        (offset + this.sequenceLength - this.overlapLength) * 2;
      this.midBuffer.set(
        this.inputBuffer.vector.subarray(midStart, midStart + this.overlapLength * 2)
      );

      this.skipFract += this.nominalSkip;
      const skip = Math.floor(this.skipFract);
      this.skipFract -= skip;
      this.inputBuffer.receive(skip);
    }
  }
}

/**
 * Main SoundTouch processor combining stretch and transpose
 */
class SoundTouchEngine {
  private rateTransposer: RateTransposer;
  private timeStretch: TimeStretch;

  private _inputBuffer: FifoBuffer;
  private _intermediateBuffer: FifoBuffer;
  private _outputBuffer: FifoBuffer;

  private _rate: number = 1.0;
  private _tempo: number = 1.0;
  private virtualPitch: number = 1.0;

  constructor(sampleRate: number) {
    this.rateTransposer = new RateTransposer();
    this.timeStretch = new TimeStretch();

    this._inputBuffer = new FifoBuffer();
    this._intermediateBuffer = new FifoBuffer();
    this._outputBuffer = new FifoBuffer();

    this.timeStretch.setParameters(sampleRate);
    this.calculateEffectiveRateAndTempo();
  }

  get inputBuffer(): FifoBuffer { return this._inputBuffer; }
  get outputBuffer(): FifoBuffer { return this._outputBuffer; }

  set pitch(value: number) {
    this.virtualPitch = value;
    this.calculateEffectiveRateAndTempo();
  }

  get pitch(): number { return this.virtualPitch; }

  set pitchSemitones(semitones: number) {
    this.pitch = Math.pow(2, semitones / 12);
  }

  reset(): void {
    this.rateTransposer.reset();
    this.timeStretch.reset();
    this._inputBuffer.clear();
    this._intermediateBuffer.clear();
    this._outputBuffer.clear();
  }

  private calculateEffectiveRateAndTempo(): void {
    const oldTempo = this._tempo;
    const oldRate = this._rate;

    this._tempo = 1.0 / this.virtualPitch;
    this._rate = this.virtualPitch;

    if (Math.abs(this._tempo - oldTempo) > 1e-10) {
      this.timeStretch.tempo = this._tempo;
    }
    if (Math.abs(this._rate - oldRate) > 1e-10) {
      this.rateTransposer.rate = this._rate;
    }

    // Wire buffers based on processing order
    if (this._rate > 1) {
      this.timeStretch.inputBuffer = this._inputBuffer;
      this.timeStretch.outputBuffer = this._intermediateBuffer;
      this.rateTransposer.inputBuffer = this._intermediateBuffer;
      this.rateTransposer.outputBuffer = this._outputBuffer;
    } else {
      this.rateTransposer.inputBuffer = this._inputBuffer;
      this.rateTransposer.outputBuffer = this._intermediateBuffer;
      this.timeStretch.inputBuffer = this._intermediateBuffer;
      this.timeStretch.outputBuffer = this._outputBuffer;
    }
  }

  process(): void {
    if (this._rate > 1) {
      this.timeStretch.process();
      this.rateTransposer.process();
    } else {
      this.rateTransposer.process();
      this.timeStretch.process();
    }
  }
}

// ============================================================================
// AudioWorklet Processor
// ============================================================================

const ST_BLOCK_SIZE = 128;
const ST_FADE_FRAMES = 64;
const ST_MIN_FRAMES_FOR_PROCESSING = 4096;

class SoundTouchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      {
        name: 'semitone',
        defaultValue: 0,
        minValue: -36,
        maxValue: 36,
        automationRate: 'k-rate',
      },
      {
        name: 'cents',
        defaultValue: 0,
        minValue: -100,
        maxValue: 100,
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

  private soundTouch: SoundTouchEngine;
  private outputBuffer: Float32Array;
  private bypassed: boolean = true;
  private fadeCounter: number = 0;
  private previousPitch: number = 1.0;
  private skipBuffer: boolean = false;
  private skipBufferCounter: number = 0;

  constructor() {
    super();
    this.soundTouch = new SoundTouchEngine(sampleRate);
    this.outputBuffer = new Float32Array(ST_BLOCK_SIZE * 2);

    this.port.onmessage = (event) => {
      if (event.data.type === 'reset') {
        this.soundTouch.reset();
        this.bypassed = true;
      }
    };

    // Signal ready
    Promise.resolve().then(() => {
      this.port.postMessage({ type: 'ready' });
    });
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input?.[0] || !output?.[0]) {
      return true;
    }

    const numSamples = input[0].length;
    const left = input[0];
    const right = input.length > 1 ? input[1] : left;
    const outLeft = output[0];
    const outRight = output.length > 1 ? output[1] : null;

    // Get parameters
    const semitone = parameters.semitone[0];
    const cents = parameters.cents[0];
    const enabled = parameters.enabled[0] >= 0.5;

    // Calculate pitch
    const totalSemitones = semitone + cents / 100;
    const targetPitch = Math.pow(2, totalSemitones / 12);

    // Check for bypass
    const shouldBypass = !enabled || Math.abs(targetPitch - 1.0) < 0.001;

    // Handle pitch changes
    if (Math.abs(targetPitch - this.previousPitch) > 0.001) {
      // Large pitch jump - skip some buffers to avoid artifacts
      if (Math.abs(totalSemitones) > 3 || (this.bypassed && !shouldBypass)) {
        this.skipBuffer = true;
        this.skipBufferCounter = 32;
      }
      this.soundTouch.pitchSemitones = totalSemitones;
      this.previousPitch = targetPitch;
    }

    // Handle bypass transitions
    if (shouldBypass && !this.bypassed) {
      this.skipBuffer = true;
      this.skipBufferCounter = 32;
      this.bypassed = true;
      this.soundTouch.reset();
    } else if (!shouldBypass && this.bypassed) {
      this.skipBuffer = true;
      this.skipBufferCounter = 32;
      this.bypassed = false;
    }

    // If bypassed, pass through
    if (this.bypassed && this.skipBufferCounter <= 0 && this.fadeCounter <= 0) {
      outLeft.set(left);
      if (outRight) outRight.set(right);
      return true;
    }

    // Interleave input samples
    const interleavedInput = new Float32Array(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      interleavedInput[i * 2] = left[i];
      interleavedInput[i * 2 + 1] = right[i];
    }

    // Push to SoundTouch
    this.soundTouch.inputBuffer.putSamples(interleavedInput, 0, numSamples);

    // Process if we have enough samples
    if (this.soundTouch.inputBuffer.frameCount >= ST_MIN_FRAMES_FOR_PROCESSING) {
      this.soundTouch.process();
    }

    // Extract output
    this.outputBuffer.fill(0);
    const available = Math.min(numSamples, this.soundTouch.outputBuffer.frameCount);
    if (available > 0) {
      this.soundTouch.outputBuffer.receiveSamples(this.outputBuffer, available);
    }

    // Handle skip buffer period
    if (this.skipBufferCounter > 0) {
      this.skipBufferCounter--;
      outLeft.set(left);
      if (outRight) outRight.set(right);
      return true;
    }

    // Handle fade
    if (this.skipBuffer) {
      this.fadeCounter = ST_FADE_FRAMES;
      this.skipBuffer = false;
    }

    // Apply output
    if (this.fadeCounter > 0) {
      const fadeProgress = 1 - this.fadeCounter / ST_FADE_FRAMES;
      for (let i = 0; i < numSamples; i++) {
        outLeft[i] = left[i] * (1 - fadeProgress) + this.outputBuffer[i * 2] * fadeProgress;
        if (outRight) {
          outRight[i] = right[i] * (1 - fadeProgress) + this.outputBuffer[i * 2 + 1] * fadeProgress;
        }
      }
      this.fadeCounter--;
    } else {
      for (let i = 0; i < numSamples; i++) {
        outLeft[i] = this.outputBuffer[i * 2];
        if (outRight) {
          outRight[i] = this.outputBuffer[i * 2 + 1];
        }
      }
    }

    return true;
  }
}

registerProcessor('soundtouch-processor', SoundTouchProcessor);
