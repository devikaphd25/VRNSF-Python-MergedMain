# VR-Classroom

A WebXR experience built with [Immersive Web SDK (IWSDK)](https://iwsdk.dev/) — Meta's open-source framework for building immersive web apps on top of Three.js.

## Features

- Entity Component System (ECS) architecture
- Spatial UI panels
- Runs in VR/AR headsets, with mouse-and-keyboard emulation on desktop browsers — no headset required for development

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- A WebXR-compatible headset (Meta Quest, HTC Vive, etc.) for immersive testing — optional, thanks to the built-in emulator (IWER)

## Getting Started

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

This starts the Vite-based dev server with hot reload. Open the printed local URL in your browser to test with mouse/keyboard, or connect a headset on the same network to test immersively.

### Build for production

```bash
npm run build
```

## Project Structure

```
vr-classroom/
├── src/              # Application source code
├── public/           # Static assets (models, textures, audio)
├── vite.config.ts    # Build config with IWSDK plugins
└── package.json
```

## Tech Stack

- [Three.js](https://threejs.org/) — 3D rendering
- [IWSDK](https://iwsdk.dev/) (`@iwsdk/core`) — WebXR framework, ECS, input, locomotion, spatial UI
- [elics](https://github.com/elics-js/elics) — ECS engine
- Vite — build tooling

## Assets

3D models should be in **GLTF/GLB** format. Convert other formats (FBX, OBJ, etc.) using [Blender](https://www.blender.org/).

## Deployment

Build the project (`npm run build`) and deploy the output to any static host. WebXR apps built with IWSDK can be shared via a simple URL — no app store required.

## License

TBD

## Resources

- [IWSDK Documentation](https://iwsdk.dev/)
- [IWSDK GitHub](https://github.com/facebook/immersive-web-sdk)
