#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/app/src/main/assets"
mkdir -p "$ASSETS"

FACE_URL="https://huggingface.co/abiral1011/skin_detect/resolve/main/face_landmarker.task"
PHONE_URL="https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model_quantized.onnx"

fetch_model() {
  local url="$1" out="$2" min_bytes="$3"
  if [[ -f "$out" ]] && [[ $(wc -c < "$out") -ge "$min_bytes" ]]; then
    echo "Using cached $(basename "$out") ($(wc -c < "$out") bytes)"
    return
  fi
  echo "Downloading $(basename "$out") from Hugging Face..."
  curl -L --fail --retry 3 --retry-delay 2 "$url" -o "$out.tmp"
  local size
  size=$(wc -c < "$out.tmp")
  if [[ "$size" -lt "$min_bytes" ]]; then
    echo "Model download too small: $size bytes" >&2
    rm -f "$out.tmp"
    exit 1
  fi
  mv "$out.tmp" "$out"
  echo "Saved $(basename "$out") ($size bytes)"
}

fetch_model "$FACE_URL" "$ASSETS/face_landmarker.task" 3000000
fetch_model "$PHONE_URL" "$ASSETS/yolos_tiny_quantized.onnx" 9000000

echo "Hugging Face models ready."
