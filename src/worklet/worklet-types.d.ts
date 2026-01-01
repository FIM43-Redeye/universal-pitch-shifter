/**
 * Type declarations for AudioWorklet global scope
 *
 * These types are available in the AudioWorkletGlobalScope but not
 * in the default TypeScript lib.
 */

// Global sample rate in AudioWorkletGlobalScope
declare const sampleRate: number;

// Global currentFrame in AudioWorkletGlobalScope
declare const currentFrame: number;

// Global currentTime in AudioWorkletGlobalScope
declare const currentTime: number;

// Register a processor class
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// Base class for audio worklet processors
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

// Audio param descriptor for processor parameters
interface AudioParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}
