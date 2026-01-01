/**
 * SoundTouch audio processing library - TypeScript implementation
 *
 * This is a clean-room TypeScript implementation of the SoundTouch algorithm
 * for real-time pitch shifting and time stretching. Based on the WSOLA
 * (Waveform Similarity Overlap-Add) technique.
 *
 * Original algorithm by Olli Parviainen (soundtouch.surina.net)
 * This implementation is GPL-2.0 licensed for use in Universal Pitch Shifter.
 */

/**
 * Circular buffer for audio samples (interleaved stereo).
 * Manages sample storage with efficient put/receive operations.
 */
export class FifoSampleBuffer {
  private _vector: Float32Array;
  private _position: number = 0;
  private _frameCount: number = 0;

  constructor(initialCapacity: number = 4096) {
    // Interleaved stereo: 2 samples per frame
    this._vector = new Float32Array(initialCapacity * 2);
  }

  /** Current read position in frames */
  get position(): number {
    return this._position;
  }

  /** Number of frames currently in buffer */
  get frameCount(): number {
    return this._frameCount;
  }

  /** Start index in the underlying array */
  get startIndex(): number {
    return this._position * 2;
  }

  /** End index in the underlying array */
  get endIndex(): number {
    return (this._position + this._frameCount) * 2;
  }

  /** Get the underlying sample vector */
  get vector(): Float32Array {
    return this._vector;
  }

  /** Clear all samples from buffer */
  clear(): void {
    this.receive(this._frameCount);
    this.rewind();
  }

  /** Mark frames as written (after external write) */
  put(numFrames: number): void {
    this._frameCount += numFrames;
  }

  /** Add interleaved stereo samples to buffer */
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

  /** Copy samples from another buffer */
  putBuffer(buffer: FifoSampleBuffer, offset: number = 0, numFrames?: number): void {
    if (numFrames === undefined) {
      numFrames = buffer.frameCount - offset;
    }
    this.putSamples(buffer.vector, buffer.position + offset, numFrames);
  }

  /** Remove frames from the beginning of buffer */
  receive(numFrames: number): void {
    if (numFrames < 0 || numFrames > this._frameCount) {
      numFrames = this._frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  }

  /** Copy samples to output array and remove from buffer */
  receiveSamples(output: Float32Array, numFrames: number): void {
    const count = numFrames * 2;
    const start = this.startIndex;
    output.set(this._vector.subarray(start, start + count));
    this.receive(numFrames);
  }

  /** Extract samples without removing (peek) */
  extract(output: Float32Array, offset: number, numFrames: number): void {
    const start = this.startIndex + offset * 2;
    const count = numFrames * 2;
    output.set(this._vector.subarray(start, start + count));
  }

  /** Ensure buffer can hold at least numFrames total */
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

  /** Compact buffer by moving data to beginning */
  rewind(): void {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
}

/**
 * Rate transposer - changes playback rate using linear interpolation.
 * Used for pitch shifting when combined with time stretching.
 */
export class RateTransposer {
  private _rate: number = 1.0;
  private slopeCount: number = 0;
  private prevSampleL: number = 0;
  private prevSampleR: number = 0;

  inputBuffer: FifoSampleBuffer;
  outputBuffer: FifoSampleBuffer;

  constructor() {
    this.inputBuffer = new FifoSampleBuffer();
    this.outputBuffer = new FifoSampleBuffer();
  }

  set rate(value: number) {
    this._rate = value;
  }

  get rate(): number {
    return this._rate;
  }

  reset(): void {
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  /** Process samples through rate transposition */
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

  /** Linear interpolation transposition */
  private transpose(numFrames: number): number {
    if (numFrames === 0) return 0;

    const input = this.inputBuffer.vector;
    const inputStart = this.inputBuffer.startIndex;
    const output = this.outputBuffer.vector;
    const outputStart = this.outputBuffer.endIndex;

    let outputCount = 0;
    let inputIndex = 0;

    // Process samples using previous frame
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

    // Process remaining samples
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

    // Save last frame for next iteration
    this.prevSampleL = input[inputStart + (numFrames - 1) * 2];
    this.prevSampleR = input[inputStart + (numFrames - 1) * 2 + 1];

    return outputCount;
  }
}

/**
 * Time-domain stretch processor using WSOLA algorithm.
 * Changes tempo without affecting pitch.
 */
export class TimeStretch {
  private sampleRate: number = 44100;
  private _tempo: number = 1.0;

  // Sequence and seek parameters (in milliseconds)
  private sequenceMs: number = 0;  // 0 = auto
  private seekWindowMs: number = 0;  // 0 = auto
  private overlapMs: number = 16;

  // Derived parameters (in samples/frames)
  private sequenceLength: number = 0;
  private seekLength: number = 0;
  private overlapLength: number = 0;

  // Processing state
  private nominalSkip: number = 0;
  private skipFract: number = 0;
  private midBuffer: Float32Array | null = null;
  private refMidBuffer: Float32Array | null = null;
  private sampleReq: number = 0;

  // Quick seek lookup tables
  private static readonly SCAN_OFFSETS: number[][] = [
    [124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0],
    [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];

  inputBuffer: FifoSampleBuffer;
  outputBuffer: FifoSampleBuffer;

  constructor() {
    this.inputBuffer = new FifoSampleBuffer();
    this.outputBuffer = new FifoSampleBuffer();
  }

  /** Configure time stretch parameters */
  setParameters(
    sampleRate: number,
    sequenceMs: number = 0,
    seekWindowMs: number = 0,
    overlapMs: number = 16
  ): void {
    if (sampleRate > 0) this.sampleRate = sampleRate;
    if (overlapMs > 0) this.overlapMs = overlapMs;

    // sequenceMs=0 means auto-calculate based on tempo
    this.sequenceMs = sequenceMs;
    this.seekWindowMs = seekWindowMs;

    this.calculateEffectiveParams();
    this.calculateOverlapLength();
    this.tempo = this._tempo; // Recalculate dependent values
  }

  set tempo(value: number) {
    this._tempo = value;
    this.calculateEffectiveParams();

    // Calculate skip amounts
    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;

    const skip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(skip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }

  get tempo(): number {
    return this._tempo;
  }

  get seekWindowLength(): number {
    return this.sequenceLength;
  }

  reset(): void {
    this.midBuffer = null;
    this.skipFract = 0;
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  /** Auto-calculate sequence/seek params based on tempo */
  private calculateEffectiveParams(): void {
    // Tempo-adaptive sequence length
    if (this.sequenceMs === 0) {
      // Auto: interpolate between 125ms (slow) and 50ms (fast)
      const seqMs = 125 - (125 - 50) / (2 - 0.5) * (this._tempo - 0.5);
      this.sequenceLength = Math.floor(
        this.sampleRate * Math.max(50, Math.min(125, seqMs)) / 1000
      );
    } else {
      this.sequenceLength = Math.floor(this.sampleRate * this.sequenceMs / 1000);
    }

    // Tempo-adaptive seek window
    if (this.seekWindowMs === 0) {
      // Auto: interpolate between 25ms (slow) and 15ms (fast)
      const seekMs = 25 - (25 - 15) / (2 - 0.5) * (this._tempo - 0.5);
      this.seekLength = Math.floor(
        this.sampleRate * Math.max(15, Math.min(25, seekMs)) / 1000
      );
    } else {
      this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1000);
    }
  }

  private calculateOverlapLength(): void {
    let overlap = Math.floor(this.sampleRate * this.overlapMs / 1000);
    if (overlap < 16) overlap = 16;
    overlap -= overlap % 8; // Align to 8 samples

    this.overlapLength = overlap;
    this.refMidBuffer = new Float32Array(overlap * 2);
    this.midBuffer = new Float32Array(overlap * 2);
  }

  /** Find the best overlap position using quick seek */
  private seekBestOverlapPosition(): number {
    this.precalcCorrReference();
    return this.seekBestOverlapPositionQuick();
  }

  /** Quick seek using coarse-to-fine search */
  private seekBestOverlapPositionQuick(): number {
    let bestOffset = 0;
    let bestCorr = Number.MIN_VALUE;
    let scanCount = 0;
    let corrOffset = 0;

    for (let scanLevel = 0; scanLevel < 4; scanLevel++) {
      scanCount = 0;
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

  /** Precalculate correlation reference (weighted mid buffer) */
  private precalcCorrReference(): void {
    for (let i = 0; i < this.overlapLength; i++) {
      const weight = i * (this.overlapLength - i);
      const idx = i * 2;
      this.refMidBuffer![idx] = this.midBuffer![idx] * weight;
      this.refMidBuffer![idx + 1] = this.midBuffer![idx + 1] * weight;
    }
  }

  /** Calculate cross-correlation at given offset */
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

  /** Overlap-add the found segment with mid buffer */
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

  /** Main processing function */
  process(): void {
    // Initialize mid buffer on first call
    if (this.midBuffer === null || this.midBuffer.length === 0) {
      if (this.inputBuffer.frameCount < this.overlapLength) {
        return;
      }
      this.midBuffer = new Float32Array(this.overlapLength * 2);
      this.inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
    }

    // Process while we have enough samples
    while (this.inputBuffer.frameCount >= this.sampleReq) {
      // Find best overlap position
      const offset = this.seekBestOverlapPosition();

      // Output overlap-added segment
      this.outputBuffer.ensureCapacity(
        this.outputBuffer.frameCount + this.overlapLength
      );
      this.overlap(offset);
      this.outputBuffer.put(this.overlapLength);

      // Output middle section (non-overlapped)
      const middleLength = this.seekWindowLength - 2 * this.overlapLength;
      if (middleLength > 0) {
        this.outputBuffer.putBuffer(
          this.inputBuffer,
          offset + this.overlapLength,
          middleLength
        );
      }

      // Save end of sequence as next mid buffer
      const midStart =
        this.inputBuffer.startIndex +
        (offset + this.seekWindowLength - this.overlapLength) * 2;
      this.midBuffer.set(
        this.inputBuffer.vector.subarray(midStart, midStart + this.overlapLength * 2)
      );

      // Advance input
      this.skipFract += this.nominalSkip;
      const skip = Math.floor(this.skipFract);
      this.skipFract -= skip;
      this.inputBuffer.receive(skip);
    }
  }
}

/**
 * Main SoundTouch processor combining time stretch and rate transposition.
 */
export class SoundTouch {
  readonly rateTransposer: RateTransposer;
  readonly timeStretch: TimeStretch;

  private _inputBuffer: FifoSampleBuffer;
  private _intermediateBuffer: FifoSampleBuffer;
  private _outputBuffer: FifoSampleBuffer;

  private _rate: number = 1.0;
  private _tempo: number = 1.0;
  private virtualPitch: number = 1.0;
  private virtualRate: number = 1.0;
  private virtualTempo: number = 1.0;

  constructor() {
    this.rateTransposer = new RateTransposer();
    this.timeStretch = new TimeStretch();

    this._inputBuffer = new FifoSampleBuffer();
    this._intermediateBuffer = new FifoSampleBuffer();
    this._outputBuffer = new FifoSampleBuffer();

    this.calculateEffectiveRateAndTempo();
  }

  get inputBuffer(): FifoSampleBuffer {
    return this._inputBuffer;
  }

  get outputBuffer(): FifoSampleBuffer {
    return this._outputBuffer;
  }

  /** Set playback rate (affects both pitch and tempo) */
  set rate(value: number) {
    this.virtualRate = value;
    this.calculateEffectiveRateAndTempo();
  }

  get rate(): number {
    return this._rate;
  }

  /** Set tempo (without affecting pitch) */
  set tempo(value: number) {
    this.virtualTempo = value;
    this.calculateEffectiveRateAndTempo();
  }

  get tempo(): number {
    return this._tempo;
  }

  /** Set pitch (without affecting tempo) */
  set pitch(value: number) {
    this.virtualPitch = value;
    this.calculateEffectiveRateAndTempo();
  }

  get pitch(): number {
    return this.virtualPitch;
  }

  /** Set pitch in semitones */
  set pitchSemitones(semitones: number) {
    this.pitch = Math.pow(2, semitones / 12);
  }

  /** Reset all processing state */
  reset(): void {
    this.rateTransposer.reset();
    this.timeStretch.reset();
    this._inputBuffer.clear();
    this._intermediateBuffer.clear();
    this._outputBuffer.clear();
  }

  /** Configure the time stretch parameters */
  setParameters(
    sampleRate: number,
    sequenceMs?: number,
    seekWindowMs?: number,
    overlapMs?: number
  ): void {
    this.timeStretch.setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs);
  }

  /** Recalculate effective rate and tempo from virtual values */
  private calculateEffectiveRateAndTempo(): void {
    const oldTempo = this._tempo;
    const oldRate = this._rate;

    // Pitch = tempo change + rate change that cancel out for playback rate
    // tempo / pitch maintains constant playback speed
    // rate * pitch adjusts for the pitch change
    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;

    // Update components if values changed
    if (Math.abs(this._tempo - oldTempo) > 1e-10) {
      this.timeStretch.tempo = this._tempo;
    }
    if (Math.abs(this._rate - oldRate) > 1e-10) {
      this.rateTransposer.rate = this._rate;
    }

    // Wire up buffers based on processing order
    if (this._rate > 1) {
      // Rate > 1: time stretch first, then rate transpose
      if (this._outputBuffer !== this.rateTransposer.outputBuffer) {
        this.timeStretch.inputBuffer = this._inputBuffer;
        this.timeStretch.outputBuffer = this._intermediateBuffer;
        this.rateTransposer.inputBuffer = this._intermediateBuffer;
        this.rateTransposer.outputBuffer = this._outputBuffer;
      }
    } else {
      // Rate <= 1: rate transpose first, then time stretch
      if (this._outputBuffer !== this.timeStretch.outputBuffer) {
        this.rateTransposer.inputBuffer = this._inputBuffer;
        this.rateTransposer.outputBuffer = this._intermediateBuffer;
        this.timeStretch.inputBuffer = this._intermediateBuffer;
        this.timeStretch.outputBuffer = this._outputBuffer;
      }
    }
  }

  /** Process buffered samples */
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
