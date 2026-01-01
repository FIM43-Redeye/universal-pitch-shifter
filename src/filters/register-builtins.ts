/**
 * Register Built-in Filters
 *
 * Registers all built-in filters with the FilterRegistry.
 * Import this module to ensure filters are available.
 */

import { FilterRegistry, defineFilter } from './registry';
import { RubberbandFilter } from './pitch/rubberband/filter';
import { SoundTouchFilter } from './pitch/soundtouch/filter';
import { ParametricEQFilter } from './eq/parametric/filter';
import { CompressorFilter } from './dynamics/compressor/filter';
import { DelayFilter } from './time/delay/filter';

// Register pitch shifting filters
FilterRegistry.register(
  defineFilter({
    id: 'rubberband',
    displayName: 'RubberBand Pitch Shifter',
    description: 'High-quality pitch shifting with formant preservation',
    category: 'pitch',
    parameters: [
      { name: 'semitone', label: 'Semitones', type: 'number', value: 0, defaultValue: 0, min: -36, max: 36, step: 1, unit: 'st' },
      { name: 'cents', label: 'Fine Tune', type: 'number', value: 0, defaultValue: 0, min: -100, max: 100, step: 1, unit: 'cents' },
      { name: 'formant', label: 'Formant', type: 'number', value: 1.0, defaultValue: 1.0, min: 0.5, max: 2.0, step: 0.01, unit: 'x' },
    ],
    requiresWasm: true,
    cpuUsage: 'medium',
    tags: ['pitch', 'shift', 'formant', 'voice', 'music', 'wasm'],
  }),
  () => new RubberbandFilter()
);

FilterRegistry.register(
  defineFilter({
    id: 'soundtouch',
    displayName: 'SoundTouch Pitch Shifter',
    description: 'Lightweight pitch shifting (no formant preservation)',
    category: 'pitch',
    parameters: [
      { name: 'semitone', label: 'Semitones', type: 'number', value: 0, defaultValue: 0, min: -36, max: 36, step: 1, unit: 'st' },
      { name: 'cents', label: 'Fine Tune', type: 'number', value: 0, defaultValue: 0, min: -100, max: 100, step: 1, unit: 'cents' },
    ],
    requiresWasm: false,
    cpuUsage: 'low',
    tags: ['pitch', 'shift', 'lightweight', 'fast'],
  }),
  () => new SoundTouchFilter()
);

// Register EQ filters
FilterRegistry.register(
  defineFilter({
    id: 'parametric-eq',
    displayName: 'Parametric EQ',
    description: '3-band equalizer (low shelf, mid peak, high shelf)',
    category: 'eq',
    parameters: [
      { name: 'lowFreq', label: 'Low Freq', type: 'number', value: 200, defaultValue: 200, min: 20, max: 500, step: 10, unit: 'Hz' },
      { name: 'lowGain', label: 'Low Gain', type: 'number', value: 0, defaultValue: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
      { name: 'midFreq', label: 'Mid Freq', type: 'number', value: 1000, defaultValue: 1000, min: 200, max: 8000, step: 50, unit: 'Hz' },
      { name: 'midGain', label: 'Mid Gain', type: 'number', value: 0, defaultValue: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
      { name: 'midQ', label: 'Mid Q', type: 'number', value: 1.0, defaultValue: 1.0, min: 0.1, max: 10, step: 0.1, unit: '' },
      { name: 'highFreq', label: 'High Freq', type: 'number', value: 4000, defaultValue: 4000, min: 2000, max: 16000, step: 100, unit: 'Hz' },
      { name: 'highGain', label: 'High Gain', type: 'number', value: 0, defaultValue: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
    ],
    requiresWasm: false,
    cpuUsage: 'low',
    tags: ['eq', 'equalizer', 'shelf', 'peak', 'filter'],
  }),
  () => new ParametricEQFilter()
);

// Register dynamics filters
FilterRegistry.register(
  defineFilter({
    id: 'compressor',
    displayName: 'Compressor',
    description: 'Dynamic range compressor with threshold, ratio, and makeup gain',
    category: 'dynamics',
    parameters: [
      { name: 'threshold', label: 'Threshold', type: 'number', value: -24, defaultValue: -24, min: -100, max: 0, step: 1, unit: 'dB' },
      { name: 'knee', label: 'Knee', type: 'number', value: 30, defaultValue: 30, min: 0, max: 40, step: 1, unit: 'dB' },
      { name: 'ratio', label: 'Ratio', type: 'number', value: 4, defaultValue: 4, min: 1, max: 20, step: 0.5, unit: ':1' },
      { name: 'attack', label: 'Attack', type: 'number', value: 0.003, defaultValue: 0.003, min: 0, max: 1, step: 0.001, unit: 's' },
      { name: 'release', label: 'Release', type: 'number', value: 0.25, defaultValue: 0.25, min: 0, max: 1, step: 0.01, unit: 's' },
      { name: 'makeupGain', label: 'Makeup Gain', type: 'number', value: 0, defaultValue: 0, min: 0, max: 24, step: 0.5, unit: 'dB' },
    ],
    requiresWasm: false,
    cpuUsage: 'low',
    tags: ['dynamics', 'compressor', 'compression', 'loudness'],
  }),
  () => new CompressorFilter()
);

// Register time-based filters
FilterRegistry.register(
  defineFilter({
    id: 'delay',
    displayName: 'Delay',
    description: 'Echo/delay effect with feedback and mix controls',
    category: 'time',
    parameters: [
      { name: 'delayTime', label: 'Delay Time', type: 'number', value: 0.25, defaultValue: 0.25, min: 0.01, max: 2.0, step: 0.01, unit: 's' },
      { name: 'feedback', label: 'Feedback', type: 'number', value: 0.3, defaultValue: 0.3, min: 0, max: 0.95, step: 0.01, unit: '' },
      { name: 'mix', label: 'Mix', type: 'number', value: 0.5, defaultValue: 0.5, min: 0, max: 1, step: 0.01, unit: '' },
    ],
    requiresWasm: false,
    cpuUsage: 'low',
    tags: ['time', 'delay', 'echo', 'effect'],
  }),
  () => new DelayFilter()
);

console.log('[FilterRegistry] Built-in filters registered:', FilterRegistry.getIds());
