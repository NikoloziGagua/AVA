# Third-party assets in the AVA UI remodel

| Asset | Where it lives | Licence | Source |
|---|---|---|---|
| Geist (variable, woff2) | `web/public/fonts/Geist-Variable.woff2` | SIL Open Font License 1.1 (`web/public/fonts/GEIST-OFL.txt`) | npm `geist@1.7.2` by Vercel with basement.studio |
| Geist Mono (variable, woff2) | `web/public/fonts/GeistMono-Variable.woff2` | SIL Open Font License 1.1 | npm `geist@1.7.2` |
| MediaPipe Face Landmarker | build-time only, face asset script (phase C) | Apache-2.0 | google-ai-edge/mediapipe |
| Depth Anything v2 small | build-time only, face asset script (phase C) | Apache-2.0 | onnx-community/depth-anything-v2-small |

The face portrait is private developer input, AI-generated, and is never served, bundled or committed.
Only derived, bounded face data ships (contract `ui-remodel` v1 §5).
