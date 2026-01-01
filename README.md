# Universal Pitch Shifter

A modular audio filter framework for the browser, inspired by MPV's audio filter system.

**Free as in freedom. Free as in beer.**

## Features

### Working Now
- **SoundTouch Pitch Shifter**: Lightweight pure-JS implementation using WSOLA algorithm
- **RubberBand Pitch Shifter**: High-quality WASM-based shifting with formant preservation
- Automatic engine fallback (RubberBand -> SoundTouch if WASM fails)
- Modular filter pipeline architecture
- Real-time parameter adjustment (semitones, cents)
- Bypass toggle for A/B comparison

### Planned Features
- **More filters**: EQ, compressor, delay, reverb
- **FFmpeg WASM**: Bring libavfilter to the browser
- **Visual UI**: Node graph editor + tabbed panels
- **Presets**: Save/load filter configurations
- **Per-site settings**: Remember settings for each domain

## Quick Start

```bash
npm install
npm run build
```

Load the extension:
1. Chrome: `chrome://extensions` -> Developer Mode -> Load unpacked -> select `dist/`
2. Navigate to a page with video (YouTube, etc.)
3. Click the extension icon
4. Adjust semitones/cents and hear the pitch change!

## Development

```bash
npm run dev          # Build with watch mode
npm run build        # Production build
npm run typecheck    # Type checking
npm run clean        # Clean build artifacts
```

### Building WASM (RubberBand)

```bash
./scripts/build-wasm.sh
```

Requires `emscripten` package (Ubuntu: `sudo apt install emscripten`).

## Architecture

```
src/
  manifest.json           # Extension manifest (MV3)
  background/             # Service worker
  content/                # Media detection + audio routing
    content.ts            # Main content script
  popup/                  # Extension UI
  filters/                # Filter implementations
    base.ts               # Base filter interface
    pipeline.ts           # Filter chain management
    pitch/
      rubberband/         # High-quality WASM-based
      soundtouch/         # Lightweight pure-JS
  worklet/                # AudioWorklet processors
    rubberband-processor.ts
    soundtouch-processor.ts
  wasm/                   # Compiled WASM modules
    rubberband.wasm       # 341KB RubberBand library
```

### Filter Pipeline

Filters are connected in series:
```
Media Element -> FilterPipeline -> Speakers
                     |
            [Filter1] -> [Filter2] -> ...
```

Each filter implements the `AudioFilter` interface:
- `initialize(context)` - Set up AudioWorklet
- `setParameter(name, value)` - Real-time control
- `inputNode` / `outputNode` - Audio graph connections
- `bypassed` - Enable/disable without removing

## Technical Details

### Why AudioWorklet?
- Runs in dedicated thread (no main thread jank)
- Low latency (~128 samples / ~3ms at 44.1kHz)
- Can load WASM modules for DSP

### Why Two Engines?

| Engine | Size | Quality | CPU | Use Case |
|--------|------|---------|-----|----------|
| SoundTouch | 10KB JS | Good | Low | Default, mobile |
| RubberBand | 341KB WASM | Excellent | Medium | Formant preservation |

SoundTouch uses WSOLA (Waveform Similarity Overlap-Add) - fast but can sound "chorusy" on extreme shifts.

RubberBand uses phase-vocoder with formant preservation - voices stay natural when pitched.

## License

GPL-2.0 (required by RubberBand dependency)

## Credits

- [RubberBand](https://breakfastquay.com/rubberband/) - Audio stretching library
- [SoundTouch](https://www.surina.net/soundtouch/) - Algorithm inspiration
- [MPV](https://mpv.io/) - Filter architecture inspiration
