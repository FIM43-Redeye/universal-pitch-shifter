/**
 * Filters Module
 *
 * Exports the filter system: base interfaces, pipeline, and filter implementations.
 */

export type { AudioFilter, FilterParameter, FilterState } from "./base";
export { BaseFilter } from "./base";
export type { PipelineState } from "./pipeline";
export { FilterPipeline } from "./pipeline";

// Pitch shifting filters
export { RubberbandFilter, SoundTouchFilter } from "./pitch";

// EQ filters
export { ParametricEQFilter } from "./eq";

// Dynamics filters
export { CompressorFilter } from "./dynamics";

// Time-based filters
export { DelayFilter } from "./time";

// Registry and builtins
export { FilterRegistry, defineFilter } from "./registry";
import "./register-builtins"; // Side effect: registers all built-in filters

// Future filter implementations:
// export { ReverbFilter } from "./time/reverb";
// export { ScaletempoFilter } from "./scaletempo";
// export { VarispeedFilter } from "./varispeed";
