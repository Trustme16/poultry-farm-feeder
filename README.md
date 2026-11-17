# Poultry Farm Feeder

Netlify publishes only `public/`. Backend code remains in `netlify/functions/` and reads `DEVICE_KEY` from the Netlify environment at runtime. Secret scanning remains enabled.

## Firmware credentials

Copy `secrets.example.h` to `secrets.h` beside `feeder.ino`, then fill in your Wi-Fi credentials and device key locally. Copy `camera/secrets.example.h` to `camera/secrets.h` for the camera. Both devices must use the same device key as the Netlify `DEVICE_KEY` environment variable. These local headers and `.env` files are ignored by Git; do not commit credentials.

The previous device key was committed in the firmware source. Replace it with a new random key in Netlify and both local firmware headers, then upload the updated firmware to both devices. Netlify environment variables are not automatically available to Arduino sketches. Rotate any Wi-Fi credentials that were committed as well.

## Deployment

Deploy with the repository's `netlify.toml` settings. No frontend build step is required. Keep private configuration outside `public/`; only browser-safe files belong there.
