#!/bin/bash
#
# Build RubberBand as WebAssembly using single-file compilation
#
# Prerequisites:
#   - Emscripten SDK installed (apt install emscripten on Ubuntu)
#
# This script downloads RubberBand source and compiles it to WASM.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/build/rubberband"
OUTPUT_DIR="$PROJECT_ROOT/src/wasm"

RUBBERBAND_VERSION="3.3.0"
RUBBERBAND_URL="https://breakfastquay.com/files/releases/rubberband-${RUBBERBAND_VERSION}.tar.bz2"

echo "=== Building RubberBand WASM ==="
echo "Build dir: $BUILD_DIR"
echo "Output dir: $OUTPUT_DIR"

# Check for emscripten
if ! command -v emcc &> /dev/null; then
    echo "ERROR: emcc not found. Please install Emscripten:"
    echo "  sudo apt install emscripten"
    exit 1
fi

echo "Using emcc: $(which emcc)"
emcc --version | head -1

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Download RubberBand if not present
if [ ! -d "rubberband-${RUBBERBAND_VERSION}" ]; then
    echo "Downloading RubberBand ${RUBBERBAND_VERSION}..."
    curl -L "$RUBBERBAND_URL" -o rubberband.tar.bz2
    tar -xjf rubberband.tar.bz2
    rm rubberband.tar.bz2
fi

RB_DIR="$BUILD_DIR/rubberband-${RUBBERBAND_VERSION}"
cd "$RB_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Build using single-file compilation
# This is much simpler than the full Meson build for WASM
echo "Compiling RubberBand to WebAssembly..."

EXPORTED_FUNCTIONS='[
    "_rubberband_new",
    "_rubberband_delete",
    "_rubberband_reset",
    "_rubberband_get_engine_version",
    "_rubberband_set_time_ratio",
    "_rubberband_set_pitch_scale",
    "_rubberband_get_time_ratio",
    "_rubberband_get_pitch_scale",
    "_rubberband_set_formant_scale",
    "_rubberband_get_formant_scale",
    "_rubberband_get_latency",
    "_rubberband_get_start_delay",
    "_rubberband_set_transients_option",
    "_rubberband_set_detector_option",
    "_rubberband_set_phase_option",
    "_rubberband_set_formant_option",
    "_rubberband_set_pitch_option",
    "_rubberband_set_expected_input_duration",
    "_rubberband_get_samples_required",
    "_rubberband_set_max_process_size",
    "_rubberband_process",
    "_rubberband_available",
    "_rubberband_retrieve",
    "_rubberband_get_channel_count",
    "_malloc",
    "_free"
]'

# Remove whitespace from JSON for command line
EXPORTED_FUNCTIONS=$(echo "$EXPORTED_FUNCTIONS" | tr -d '\n' | tr -d ' ')

# Compile using single-file build
# Key flags:
#   -DNO_THREADING - AudioWorklet is single-threaded
#   -DNO_EXCEPTIONS - Disable C++ exceptions for WASM
#   -DUSE_BUILTIN_FFT - No external FFT dependencies
#   -DUSE_BQRESAMPLER - Built-in resampler
emcc \
    -O3 \
    -flto \
    -std=c++14 \
    -fno-exceptions \
    -fno-rtti \
    -DNO_EXCEPTIONS \
    -DNO_THREADING \
    -DNO_THREAD_CHECKS \
    -DUSE_BUILTIN_FFT \
    -DUSE_BQRESAMPLER \
    -DNO_TIMING \
    -I rubberband \
    single/RubberBandSingle.cpp \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createRubberbandModule" \
    -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=16777216 \
    -s MAXIMUM_MEMORY=268435456 \
    -s STACK_SIZE=1048576 \
    -s NO_EXIT_RUNTIME=1 \
    -s FILESYSTEM=0 \
    -s ASSERTIONS=0 \
    -s ENVIRONMENT='web,worker' \
    -o "$OUTPUT_DIR/rubberband.js"

# Check output
if [ -f "$OUTPUT_DIR/rubberband.wasm" ]; then
    WASM_SIZE=$(ls -lh "$OUTPUT_DIR/rubberband.wasm" | awk '{print $5}')
    JS_SIZE=$(ls -lh "$OUTPUT_DIR/rubberband.js" | awk '{print $5}')
    echo ""
    echo "=== Build complete ==="
    echo "WASM: $OUTPUT_DIR/rubberband.wasm ($WASM_SIZE)"
    echo "JS:   $OUTPUT_DIR/rubberband.js ($JS_SIZE)"
else
    echo "ERROR: WASM output not found!"
    exit 1
fi
