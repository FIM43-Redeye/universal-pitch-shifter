# Universal Pitch Shifter - Project Guide

## Vision

A **general-purpose browser audio filter framework**, inspired by MPV's audio filter system.
Not just pitch shifting - a modular pipeline where users can chain filters like:

```
source -> rubberband -> equalizer -> compressor -> output
```

Free as in freedom, free as in beer. GPL-2.0 (required by RubberBand).

## Architecture Goals

### Filter Pipeline
- Modular filter nodes that can be chained in arbitrary order
- Each filter is an AudioWorklet processor with standardized interface
- Filters can be WASM-based (RubberBand, FFmpeg-derived) or pure JS
- Hot-swappable: add/remove/reorder filters without audio glitches

### Planned Filters (Priority Order)
1. **rubberband** - Pitch shifting with formant preservation (WASM)
2. **scaletempo** - Tempo change without pitch shift (simpler than rubberband)
3. **varispeed** - Simple rate change (pitch follows tempo, like tape speed)
4. **equalizer** - Parametric EQ (pure JS, biquad filters)
5. **compressor** - Dynamics processing (pure JS)
6. **lavfi bridge** - If feasible: FFmpeg audio filters via WASM

### Browser Targets
- Chrome (Manifest V3)
- Firefox (Manifest V3, with V2 fallback if needed)
- Single codebase, build-time manifest generation

## Project Structure

```
src/
  manifest.json         # Extension manifest
  background/           # Service worker (lifecycle, messaging)
  content/              # Content script (media detection, audio graph)
  popup/                # Extension popup UI
  filters/              # Filter implementations
    base.ts             # Base filter interface
    rubberband/         # RubberBand pitch shifter
    scaletempo/         # Tempo without pitch
    varispeed/          # Simple rate change
    equalizer/          # Parametric EQ
  worklet/              # AudioWorklet processors
  wasm/                 # Compiled WASM modules
  lib/                  # Shared utilities
```

## Development Principles

### From Global Standards
- KISS, DRY, SOLID, YAGNI, TDA
- Test-driven where practical (audio DSP is hard to unit test, but filter logic isn't)
- Self-documenting code with clear naming
- Commit often, commit judiciously
- No hardcoding - design for flexibility
- LF line endings, POSIX assumptions
- No emoji in code or commits

### Project-Specific
- **Filters are plugins**: Each filter should be self-contained and independently testable
- **WASM is optional**: Core functionality should work with JS fallbacks
- **Latency matters**: Audio processing must be real-time; measure and minimize latency
- **Memory matters**: AudioWorklets run in constrained environments
- **Fail gracefully**: If a filter fails to load, bypass it rather than breaking audio

## Filter Interface

Every filter implements:

```typescript
interface AudioFilter {
  readonly name: string;
  readonly parameters: FilterParameter[];

  // Lifecycle
  initialize(context: AudioContext): Promise<void>;
  dispose(): void;

  // Audio graph
  readonly inputNode: AudioNode;
  readonly outputNode: AudioNode;

  // Control
  setParameter(name: string, value: number): void;
  getParameter(name: string): number;
  bypass(enabled: boolean): void;
}
```

## Build & Test

```bash
npm install          # Install dependencies
npm run dev          # Build with watch mode
npm run build        # Production build
npm run typecheck    # TypeScript validation

# Load dist/ as unpacked extension in browser
```

## WASM Compilation

RubberBand and other C/C++ libraries compile via Emscripten:

```bash
./scripts/build-wasm.sh          # Build all WASM modules
./scripts/build-wasm.sh rubberband  # Build specific module
```

Requires: Emscripten SDK, CMake

## Key Technical Decisions

### Why AudioWorklet over ScriptProcessorNode?
- ScriptProcessorNode is deprecated
- AudioWorklet runs in dedicated thread (no main thread jank)
- Better latency characteristics

### Why not Web Audio API native nodes only?
- No native pitch shifting node exists
- BiquadFilterNode covers EQ but not dynamics well
- WASM gives us access to battle-tested C++ libraries

### Why RubberBand specifically?
- Industry-standard quality (used in Audacity, Ardour, etc.)
- GPL-2.0 is acceptable for this project
- Supports formant preservation (voice sounds natural when shifted)

### Content Script Injection Strategy
- Inject into MAIN world to access page's AudioContext
- Hook into MediaElement before page scripts can
- Respect site blocklists (don't break audio on certain sites)

## Current Status

**Skeleton complete, filters not yet implemented.**

- [x] Project structure
- [x] Manifest (MV3)
- [x] Content script (media detection)
- [x] Popup UI (basic controls)
- [x] AudioWorklet shell (passthrough)
- [ ] RubberBand WASM integration
- [ ] Filter pipeline architecture
- [ ] Additional filters
- [ ] Preset system
- [ ] Per-site settings

## Resources

- [RubberBand Library](https://breakfastquay.com/rubberband/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [MPV Audio Filters](https://mpv.io/manual/master/#audio-filters)
- [Emscripten](https://emscripten.org/)

## Contributing

This is a personal project but PRs welcome. Key areas needing help:
- WASM compilation expertise
- DSP algorithm implementation
- Cross-browser testing
- UI/UX improvements
