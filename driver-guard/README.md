# Driver Guard AI

Phone-first experimental driver distraction warning **and trip mapping** PWA.

## What it does

- Uses the front camera after an explicit Start tap.
- Calibrates the driver's normal forward-facing pose.
- Uses face landmarks to detect head-turn / looking up or down, prolonged eye closure, and face missing.
- Optionally loads `Xenova/yolos-tiny` from Hugging Face through Transformers.js to detect a visible `cell phone` object.
- Gives a spoken **Eyes on the road** warning and vibration first.
- Escalates to a repeating Web Audio siren and vibration if the distraction continues.
- Tracks the drive with browser GPS when permission is granted.
- Draws the complete recorded route on an OpenStreetMap/Leaflet map.
- Pins distraction starts, trigger changes, phone detections, warnings, alarms and recoveries to the map when GPS is available.
- Records timestamps, GPS accuracy, available speed/heading, distance and drive duration.
- Saves completed drives locally in IndexedDB for later review on the same device.
- Exports the raw drive as JSON or GPX, including event waypoints.
- Requests a screen wake lock when supported.
- Runs camera inference in the browser; video frames are not uploaded or saved by this app.

## Phone test

1. Be parked before opening or configuring the app.
2. Open the app over HTTPS and allow front-camera and location access.
3. Set your media volume to a level you can clearly hear.
4. Tap **Test warning + alarm**.
5. Mount the phone so your face is clearly visible.
6. Tap **Start drive** and look straight ahead during calibration.
7. While still parked, test by turning your head away and confirm a trigger marker appears on the map.
8. Tap **Stop + save drive** and test JSON/GPX export.

The Hugging Face object-detection model is downloaded on first use and cached by the browser, so the first start may take longer.

## Privacy and storage

Camera frames are processed locally and are not intentionally uploaded by Driver Guard AI. GPS route and event records are stored in the browser's IndexedDB on that device. Map tiles are loaded from OpenStreetMap, so viewing the map requires normal network requests to the map tile provider. Exported files are created on the device.

## Important limitations

This is an experimental prototype, not a certified driver-monitoring, telematics, black-box, or collision-avoidance system. Browser camera/audio/geolocation behavior differs by device, browser, battery settings and OS. Mobile browsers can pause camera or GPS work when the app is backgrounded or the screen is locked. GPS can drift or drop out. The system can produce false positives or miss real distractions. Do not interact with the app while driving.
