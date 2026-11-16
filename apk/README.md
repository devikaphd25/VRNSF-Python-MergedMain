# UMES VR Classroom — Quest test APK

This package opens the hosted WebXR app through a temporary Cloudflare tunnel to
this computer. The web app and Node backend run on the computer; the database,
course media and avatars remain in Supabase.

- Package: `edu.umes.vrclassroom.test`
- Mode: immersive WebXR, with hand tracking declared by the Meta template.
- Output: `UMES-VR-Classroom-test.apk` after the build completes.
- Launch origin: recorded in local `runtime.json` and the Android project's manifest.

Keep the PC, the test backend on port 3100, and the tunnel running while testing.
The temporary address is embedded in the APK. Restarting the tunnel creates a new
address and requires generating/rebuilding the APK. This is not a permanent
school deployment. The app still needs internet for its Supabase media and Python
runtime downloads.

The Android project, downloaded tools and signing material are local and ignored
by Git. Keep `signing/umes-vr-test.keystore` and `signing/test-signing.json` private
and backed up: rebuilding an update requires the same signing identity. They must
never be placed under `public/` or uploaded with the APK.

## Local packaging steps

Run from the repository root after installing the tool dependencies:

1. `node apk/install-build-tools.cjs`
2. `node apk/install-android-packages.cjs` (accepts the Android SDK licenses).
3. `npm run build`
4. Set `PORT=3100` in private `.env.server`, then run `npm start`.
5. In another terminal: `apk/tooling/bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:3100`
6. Record the returned HTTPS origin in `apk/runtime.json`.
7. `node apk/generate-project.cjs`
8. `node apk/sign-and-build.cjs`

The signing/build step publishes the public certificate fingerprint as
`public/.well-known/assetlinks.json` and copies it into `dist/`. This file must be
reachable at the tunnel origin for immersive TWA verification to succeed.

Install the APK on a developer-mode Quest for testing, or provide it through your
organization's supported private-app deployment flow. Installation/launch and
controller-free rocket interaction still require a real headset check.

## When the temporary tunnel URL changes

Keep the same `apk/signing/` files and package ID. Start the local web/backend
host and the new tunnel, then run from the repository root:

```
node apk/rebuild-test-apk.cjs https://NEW-ADDRESS.trycloudflare.com
```

The helper checks the new host, updates `runtime.json`, builds the website,
increases the Android version code, generates the Android project, signs with
the existing key, verifies the APK and publishes a versioned download URL.
Provide that new URL to Device Manager for an app update. Do not reuse a previous
APK URL when deploying a new self-hosted build. The latest local APK is
`apk/UMES-VR-Classroom-test.apk`; a versioned copy is also saved beside it.
