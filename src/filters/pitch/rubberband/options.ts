/**
 * RubberBand Option Definitions
 *
 * This file defines ALL options exposed by the RubberBand library.
 * It serves as the single source of truth for parameter registration.
 *
 * TODO: Auto-generate this from rubberband-c.h during WASM build.
 * The structure here matches what we'd extract from the header.
 *
 * Reference: https://breakfastquay.com/rubberband/code-doc/
 */

/**
 * RubberBand option bitmask values (from rubberband-c.h)
 * These are the actual values passed to rubberband_new()
 */
export const RubberbandOptionValues = {
  // Processing mode
  ProcessOffline: 0x00000000,
  ProcessRealTime: 0x00000001,

  // Engine selection
  EngineFaster: 0x00000000,  // R2 engine
  EngineFiner: 0x20000000,   // R3 engine

  // Transient handling (R2 only)
  TransientsCrisp: 0x00000000,
  TransientsMixed: 0x00000100,
  TransientsSmooth: 0x00000200,

  // Transient detection (R2 only)
  DetectorCompound: 0x00000000,
  DetectorPercussive: 0x00000400,
  DetectorSoft: 0x00000800,

  // Phase handling (R2 only)
  PhaseLaminar: 0x00000000,
  PhaseIndependent: 0x00002000,

  // Threading
  ThreadingAuto: 0x00000000,
  ThreadingNever: 0x00010000,
  ThreadingAlways: 0x00020000,

  // Window size
  WindowStandard: 0x00000000,
  WindowShort: 0x00100000,
  WindowLong: 0x00200000,

  // Smoothing (R2 only)
  SmoothingOff: 0x00000000,
  SmoothingOn: 0x00800000,

  // Formant handling
  FormantShifted: 0x00000000,
  FormantPreserved: 0x01000000,

  // Pitch shifting mode
  PitchHighSpeed: 0x00000000,
  PitchHighQuality: 0x02000000,
  PitchHighConsistency: 0x04000000,

  // Channel handling
  ChannelsApart: 0x00000000,
  ChannelsTogether: 0x10000000,

  // Legacy (ignored but kept for compatibility)
  StretchElastic: 0x00000000,
  StretchPrecise: 0x00000010,
} as const;

/**
 * Option group definition - for UI generation
 */
export interface OptionGroup {
  /** Internal name */
  name: string;

  /** Display label */
  label: string;

  /** Description of this option group */
  description: string;

  /** UI group for organization */
  uiGroup: string;

  /** Default value */
  defaultValue: number;

  /** Available choices */
  choices: {
    value: number;
    label: string;
    description: string;
  }[];

  /** Only visible when this condition is met */
  visibleWhen?: {
    option: string;
    values: number[];
  };

  /** WASM function to call when this changes (if runtime-changeable) */
  runtimeSetter?: string;
}

/**
 * Continuous parameter definition
 */
export interface ContinuousParam {
  name: string;
  label: string;
  description: string;
  uiGroup: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
  /** WASM function to call */
  setter: string;
  /** WASM function to read current value */
  getter: string;
}

/**
 * All RubberBand option groups
 * This is the single source of truth for what the filter exposes.
 */
export const RubberbandOptionGroups: OptionGroup[] = [
  {
    name: 'engine',
    label: 'Engine',
    description: 'Processing engine - R3 (Finer) is higher quality but uses more CPU',
    uiGroup: 'Engine',
    defaultValue: RubberbandOptionValues.EngineFiner,
    choices: [
      {
        value: RubberbandOptionValues.EngineFaster,
        label: 'Faster (R2)',
        description: 'R2 engine - lower CPU usage, compatible with v1.x-v2.x',
      },
      {
        value: RubberbandOptionValues.EngineFiner,
        label: 'Finer (R3)',
        description: 'R3 engine - higher quality, more CPU-intensive',
      },
    ],
  },
  {
    name: 'transients',
    label: 'Transients',
    description: 'How to handle transient peaks (attacks)',
    uiGroup: 'Quality',
    defaultValue: RubberbandOptionValues.TransientsCrisp,
    choices: [
      {
        value: RubberbandOptionValues.TransientsCrisp,
        label: 'Crisp',
        description: 'Reset phases at transients for clarity - best for percussive material',
      },
      {
        value: RubberbandOptionValues.TransientsMixed,
        label: 'Mixed',
        description: 'Reset phases only outside fundamental frequency range',
      },
      {
        value: RubberbandOptionValues.TransientsSmooth,
        label: 'Smooth',
        description: 'No phase reset - smoother but less defined transients',
      },
    ],
    visibleWhen: { option: 'engine', values: [RubberbandOptionValues.EngineFaster] },
    runtimeSetter: '_rubberband_set_transients_option',
  },
  {
    name: 'detector',
    label: 'Detector',
    description: 'Transient detection mode',
    uiGroup: 'Quality',
    defaultValue: RubberbandOptionValues.DetectorCompound,
    choices: [
      {
        value: RubberbandOptionValues.DetectorCompound,
        label: 'Compound',
        description: 'General-purpose detector - works well for most material',
      },
      {
        value: RubberbandOptionValues.DetectorPercussive,
        label: 'Percussive',
        description: 'Optimized for drums and percussion',
      },
      {
        value: RubberbandOptionValues.DetectorSoft,
        label: 'Soft',
        description: 'Less aggressive onset detection',
      },
    ],
    visibleWhen: { option: 'engine', values: [RubberbandOptionValues.EngineFaster] },
    runtimeSetter: '_rubberband_set_detector_option',
  },
  {
    name: 'phase',
    label: 'Phase',
    description: 'Phase continuity between frequency bins',
    uiGroup: 'Quality',
    defaultValue: RubberbandOptionValues.PhaseLaminar,
    choices: [
      {
        value: RubberbandOptionValues.PhaseLaminar,
        label: 'Laminar',
        description: 'Preserve phase relationships - natural sound',
      },
      {
        value: RubberbandOptionValues.PhaseIndependent,
        label: 'Independent',
        description: 'Process each bin independently - can sound phasier',
      },
    ],
    visibleWhen: { option: 'engine', values: [RubberbandOptionValues.EngineFaster] },
    runtimeSetter: '_rubberband_set_phase_option',
  },
  {
    name: 'window',
    label: 'Window',
    description: 'FFT window size',
    uiGroup: 'Advanced',
    defaultValue: RubberbandOptionValues.WindowStandard,
    choices: [
      {
        value: RubberbandOptionValues.WindowStandard,
        label: 'Standard',
        description: 'Default window size - good balance',
      },
      {
        value: RubberbandOptionValues.WindowShort,
        label: 'Short',
        description: 'Better time resolution - good for speech, percussion',
      },
      {
        value: RubberbandOptionValues.WindowLong,
        label: 'Long',
        description: 'Better frequency resolution - smoother, good for sustained notes',
      },
    ],
  },
  {
    name: 'smoothing',
    label: 'Smoothing',
    description: 'Time-domain smoothing',
    uiGroup: 'Advanced',
    defaultValue: RubberbandOptionValues.SmoothingOff,
    choices: [
      {
        value: RubberbandOptionValues.SmoothingOff,
        label: 'Off',
        description: 'No smoothing - more accurate but may have artifacts',
      },
      {
        value: RubberbandOptionValues.SmoothingOn,
        label: 'On',
        description: 'Apply smoothing - softer sound, less artifacts',
      },
    ],
    visibleWhen: { option: 'engine', values: [RubberbandOptionValues.EngineFaster] },
  },
  {
    name: 'formant',
    label: 'Formant',
    description: 'Formant (vocal character) handling',
    uiGroup: 'Pitch',
    defaultValue: RubberbandOptionValues.FormantPreserved,
    choices: [
      {
        value: RubberbandOptionValues.FormantShifted,
        label: 'Shifted',
        description: 'Shift formants with pitch - chipmunk/monster effect',
      },
      {
        value: RubberbandOptionValues.FormantPreserved,
        label: 'Preserved',
        description: 'Preserve original formants - natural voice at any pitch',
      },
    ],
    runtimeSetter: '_rubberband_set_formant_option',
  },
  {
    name: 'pitchMode',
    label: 'Pitch Mode',
    description: 'Pitch shifting quality/speed tradeoff',
    uiGroup: 'Pitch',
    defaultValue: RubberbandOptionValues.PitchHighQuality,
    choices: [
      {
        value: RubberbandOptionValues.PitchHighSpeed,
        label: 'High Speed',
        description: 'Optimize for low CPU usage',
      },
      {
        value: RubberbandOptionValues.PitchHighQuality,
        label: 'High Quality',
        description: 'Optimize for best sound quality',
      },
      {
        value: RubberbandOptionValues.PitchHighConsistency,
        label: 'High Consistency',
        description: 'Optimize for smooth dynamic pitch changes',
      },
    ],
    runtimeSetter: '_rubberband_set_pitch_option',
  },
  {
    name: 'channels',
    label: 'Channels',
    description: 'Stereo processing mode',
    uiGroup: 'Advanced',
    defaultValue: RubberbandOptionValues.ChannelsTogether,
    choices: [
      {
        value: RubberbandOptionValues.ChannelsApart,
        label: 'Apart',
        description: 'Process channels independently - wider stereo, may drift',
      },
      {
        value: RubberbandOptionValues.ChannelsTogether,
        label: 'Together',
        description: 'Lock channels together - mono-compatible, centered',
      },
    ],
  },
];

/**
 * Continuous parameters (runtime-adjustable via setters)
 */
export const RubberbandContinuousParams: ContinuousParam[] = [
  {
    name: 'pitchScale',
    label: 'Pitch Scale',
    description: 'Pitch multiplier (1.0 = original, 2.0 = octave up, 0.5 = octave down)',
    uiGroup: 'Pitch',
    min: 0.25,
    max: 4.0,
    step: 0.01,
    defaultValue: 1.0,
    unit: 'x',
    setter: '_rubberband_set_pitch_scale',
    getter: '_rubberband_get_pitch_scale',
  },
  {
    name: 'formantScale',
    label: 'Formant Scale',
    description: 'Formant shift multiplier (only when formant=preserved)',
    uiGroup: 'Pitch',
    min: 0.5,
    max: 2.0,
    step: 0.01,
    defaultValue: 1.0,
    unit: 'x',
    setter: '_rubberband_set_formant_scale',
    getter: '_rubberband_get_formant_scale',
  },
];

/**
 * Helper to convert semitones to pitch scale
 */
export function semitonesToPitchScale(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Helper to convert pitch scale to semitones
 */
export function pitchScaleToSemitones(scale: number): number {
  return 12 * Math.log2(scale);
}

/**
 * Build the initial options bitmask from defaults
 */
export function buildDefaultOptions(): number {
  let options = RubberbandOptionValues.ProcessRealTime;

  for (const group of RubberbandOptionGroups) {
    options |= group.defaultValue;
  }

  return options;
}
