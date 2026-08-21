# Driver Guard AI

Phone-first experimental driver distraction warning PWA.

## What it does

- Uses the front camera after an explicit Start tap.
- Calibrates the driver's normal forward-facing pose.
- Uses face landmarks to detect head-turn / looking up or down, prolonged eye closure, and face missing.
- Optionally loads `Xenova/yolos-tiny` from Hugging Face through Transformers.js to detect a visible `cell phone` object.
- Gives a spoken **Eyes on the road** warning and vibration first.
- Escalates to a repeating Web Audio siren and vibration if the distraction continues.
- Requests a screen wake lock when supported.
- Runs camera inference in the browser; video frames are not uploaded by this app.

## Phone test

1. Be parked before opening or configuring the app.
2. Open the app over HTTPS and allow front-camera access.
3. Set your media volume to a level you can clearly hear.
4. Tap **Test warning + alarm**.
5. Mount the phone so your face is clearly visible.
6. Tap **Start monitoring** and look straight ahead during calibration.
7. Test by turning your head away while still parked.

The Hugging Face object-detection model is downloaded on first use and cached by the browser, so the first start may take longer.

## Important limitations

This is an experimental prototype, not a certified driver-monitoring or collision-avoidance system. Browser camera/audio behavior differs by device, browser, battery settings, and OS. It can produce false positives or miss real distractions. Do not interact with the app while driving.
