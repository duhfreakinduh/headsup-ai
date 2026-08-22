# Driver Guard Android v1

Native Android replacement for the Driver Guard web prototype.

## What v1 does

- Uses the front camera through CameraX.
- Uses a Hugging Face-hosted `face_landmarker.task` model for face landmarks, eye closure, and head-pose signals.
- Filters quick blinks and accumulates evidence for sustained closed eyes / looking away.
- Uses native Android text-to-speech, alarm-stream tones, and vibration for warnings and alarms.
- Runs a foreground GPS service while a trip is active.
- Draws the route on an OpenStreetMap/osmdroid map and pins distraction events.
- Saves trip route + event history as JSON in the app's private storage.
- Optionally uses the Hugging Face `Xenova/yolos-tiny` quantized ONNX model to detect a visible cell phone.
- Keeps camera frames on the device. The model files are downloaded from Hugging Face at build time and bundled into the APK.

## Hugging Face model sources

- Face model: `https://huggingface.co/abiral1011/skin_detect/resolve/main/face_landmarker.task`
- Phone model: `https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model_quantized.onnx`

Run `scripts/fetch_hf_models.sh` before a local Gradle build.

## Build

```bash
cd driver-guard-android
./scripts/fetch_hf_models.sh
gradle testDebugUnitTest assembleDebug
```

GitHub Actions also downloads both Hugging Face models, runs the unit tests, builds the debug APK, and uploads the APK as a workflow artifact.

## Safety

Set up and test while parked. Mount the phone where the front camera can clearly see the driver's full face and both eyes. This is an experimental driver-assistance prototype, not a certified safety system, and it is not a substitute for attentive driving.
