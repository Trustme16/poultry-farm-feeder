# Poultry Farm Feeder

Netlify publishes only `public/`. Backend code remains in `netlify/functions/` and reads `DEVICE_KEY` from the Netlify environment at runtime. Secret scanning remains enabled.

## Firmware credentials

Copy `secrets.example.h` to `secrets.h` beside `feeder.ino`, then fill in your Wi-Fi credentials and device key locally. Copy `camera/secrets.example.h` to `camera/secrets.h` for the camera. Both devices must use the same device key as the Netlify `DEVICE_KEY` environment variable. These local headers and `.env` files are ignored by Git; do not commit credentials.

The previous device key was committed in the firmware source. Replace it with a new random key in Netlify and both local firmware headers, then upload the updated firmware to both devices. Netlify environment variables are not automatically available to Arduino sketches. Rotate any Wi-Fi credentials that were committed as well.

## Deployment

Deploy with the repository's `netlify.toml` settings. No frontend build step is required. Keep private configuration outside `public/`; only browser-safe files belong there.

## Camera and feeding controls

All logged-in users can edit the shared daily feeding times and each gate-open duration (1–30 seconds) in Automatic feeding and camera, then choose Save feeding and camera settings. Duplicate times are rejected. Schedule times use `TZ_NAME` (Asia/Manila by default); a device that returns more than ten minutes late skips that feeding.

Camera mode is also available to all logged-in users in Automatic feeding and camera: live view, a picture after feeding, or pictures on request. All logged-in users can choose Take photo without feeding without dispensing feed. Live view shows refreshed uploaded images about every 5–8 seconds in the camera box, including when viewing remotely over HTTPS. Full motion video opens directly from the camera and requires the same Wi-Fi; browser local-network permissions may apply. The latest picture remains visible when the camera is offline, with its capture time.

Upload the updated `feeder.ino` to the feeder ESP32 to enable persistent command deduplication across retries and restarts. It records the command before moving the servo, prioritizing prevention of duplicate dispensing; a power failure between recording and moving can skip that command. The existing camera firmware supports these photo modes without reflashing.

Feeder state uses Netlify Database with a transaction lock across command delivery, schedule claims, settings, and history updates. Deployment applies the generated migration automatically. Existing state and accounts are imported from the legacy Blobs store on first access; photo files stay in Blobs. Do not run the previous firmware/backend against the same feeder during rollout.

Run `npm test` for regression checks covering concurrent scheduled polls, admin timer validation, and camera capture modes. Tests simulate the database transport; hardware behavior requires testing on the ESP32 boards.
