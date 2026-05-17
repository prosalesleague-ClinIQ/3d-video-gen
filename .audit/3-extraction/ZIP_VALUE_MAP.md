# Zip Value Map — Extraction Triage

33 zips scanned. Categories: **GOLD** = browser-runnable / short port; **SILVER** = patterns worth porting with rewrite; **REFERENCE** = native/Unity inspiration only; **SKIP** = duplicate, unrelated, or too low-value.

| Zip | Category | Top file to extract | Est. LOC | Lang | What it buys us |
|---|---|---|---|---|---|
| `maptasticjs-master.zip` | **GOLD** | `maptasticjs-master/src/maptastic.js` + `lib/numeric_solve.min.js` | ~744 + 90 | JS | Drop-in CSS-3D-transform projection mapping with drag-handles, autosave, multi-layer. Direct upgrade for `public/mapper.js` 4-corner UI. |
| `p5.mapper-main.zip` | **GOLD** | `p5.mapper-main/src/perspective/PerspT.js` + `numeric.js` | 151 + 249 | JS | Pure-JS homography solver (`computeCoefficients`, transform 4 src→dst pts). Plugs straight into `projection_mapping.js` for analytic warps. |
| `yoha-main.zip` | **GOLD** | `yoha-main/src/util/ema.ts`, `math_helper.ts`, `hand_helper.ts`, `post_model/post_model.ts` | 21 + 364 + ~30 + 214 | TS | EMA smoothing + `ComputeApproximatePalmSizePx` + post-model finger-pinch logic — alternative/complement to our 1€ filter in `public/hand_tracking.js`. |
| `GazeTracking-master.zip` | **GOLD** | `gaze_tracking/{gaze_tracking,eye,pupil}.py` | 133 + 121 + 54 | Python | Algorithms for pupil-centre (binarize + contour-centroid) and gaze ratio. Port to JS over MediaPipe FaceLandmarker iris points for `public/head_tracking.js` gaze direction (POV-parallax depth cue). |
| `artyom.js-master.zip` | **SILVER** | `build/artyom.js` | ~1800 | JS | Voice command vocabulary engine on top of Web Speech API. Add as `public/voice_commands.js` — say "next video / layer 2 / freeze hand" without re-implementing parser. |
| `Gesture-Controlled-Virtual-Mouse-main.zip` | **SILVER** | `src/Gesture_Controller.py` | ~600 | Python | Reference for pinch / fist / open-palm gesture-state machine + scroll/drag detection. Port logic (~150 LOC) into `hand_tracking.js`. |
| `XboxController-master.zip` | **SILVER** | `XboxController.py` | ~330 | Python | Reference for axis/button polling design; we'd use the browser Gamepad API but the input-map pattern is reusable for `public/projection_mapping.js` controller-driven corner nudging. |
| `eyeLike-master.zip` | **SILVER** | `src/findEyeCenter.cpp` | ~250 | C++ | Timm-Barth gradient-based pupil locator (the canonical algorithm). Port ~100 LOC to a JS shader if iris landmarks are insufficient. |
| `shape-mapper-main.zip` | **REFERENCE** | `src/main/java/spacefiller/shapemapper/*.kt` | many | Kotlin/Java/Processing | Read-only inspiration for mesh-warp UX (multi-projector calibration, mask-faces workflow). Not portable. |
| `VirtualMapper-master.zip` | **REFERENCE** | openFrameworks C++ source | huge | C++ | Native projection-mapping previs. Worth screenshotting the UI for our mapper redesign, not porting. |
| `ofxKinectProjectorToolkit-master.zip` | **REFERENCE** | `src/ofxKinectProjectorToolkit.cpp` (SVD calib) | ~400 | C++ | RGB-depth calibration math (SVD, plane fitting) — same homography theory already in p5.mapper. SKIP unless we add a real depth sensor. |
| `ofxKinectProjectorToolkitV2-master.zip` | **REFERENCE** | same | ~400 | C++ | Same as above for Kinect v2. |
| `ofxReprojection-master.zip` | **REFERENCE** | `src/ofxReprojectionCalibration.cpp` | ~500 | C++ | Same domain. SKIP. |
| `KinectWithOpenCVForUnityExample-master.zip` | **REFERENCE** | Unity C# bridge | small | C# | Unity-only, requires paid asset. SKIP. |
| `Unity3DProjectionMapping-master.zip` | **REFERENCE** | `Assets/Scripts/Homography.cs` | ~250 | C# | Same algorithm we already get from `PerspT.js`. SKIP. |
| `UnityProjectionMapping-master.zip` | **REFERENCE** | `Assets/Calibration.cs` | ~280 | C# | Same. SKIP. |
| `UnityCubes-master.zip` | **REFERENCE** | `CubeClusterMesh.cs` + shader | ~200 | C#/HLSL | Voxel-cube cluster renderer. Not aligned with current 3D-video goals. SKIP. |
| `Unity-NorthStar-main.zip` | **REFERENCE** | giant Meta XR demo | huge | C#/Unity | AR/VR demo. SKIP. |
| `VRCFaceTracking-master.zip` | **REFERENCE** | C#/WinUI app | huge | C# | Windows-only desktop app for OSC face-tracking. SKIP. |
| `EyeTrackVR-main.zip` | **REFERENCE** | hardware firmware + desktop app | huge | Py/C++ | DIY VR eye-tracker hardware project. SKIP — we already have iris landmarks via MediaPipe. |
| `pupil-master.zip` | **REFERENCE** | desktop Pupil Capture app | huge | Python | Same — desktop app, not portable. SKIP. |
| `HandPoseBarracuda-main.zip` | **REFERENCE** | Unity Barracuda inference | small | C#/HLSL | Unity-side hand inference; we already have MediaPipe HandLandmarker. SKIP. |
| `awesome-hand-pose-estimation-master.zip` | **REFERENCE** | `README.md` (paper list) + eval scripts | n/a | docs | Curated paper list. Skim README once for ideas, no code to port. |
| `J.A.R.V.I.S-master.zip` | **REFERENCE** | Python desktop assistant | many | Python | OS automation glue (weather, OCR). Off-topic. SKIP. |
| `handeye_calib_camodocal-master.zip` | **REFERENCE** | C++/ROS robotics calib | many | C++ | Robotic arm hand-eye calibration. Wrong domain. SKIP. |
| `joy_feedback_ros-master.zip` | **SKIP** | ROS rumble msg defs | ~200 | C++ | ROS-only. Browser Gamepad API has its own rumble path. SKIP. |
| `xbox-controller-mapper-main.zip` | **REFERENCE** | macOS Swift app | huge | Swift | Native macOS gamepad-to-key remapper. Inspiration only for "command wheel" UI in mapper. |
| `xbox-live-unity-plugin-main.zip` | **SKIP** | Xbox Live SDK shim | n/a | C# | Unrelated (achievements/multiplayer). SKIP. |
| `Kinect360-TouchDesigner-macOS-arm64.zip` | **REFERENCE** | `src/KinectPOP/KinectPOP.cpp` (libfreenect bridge) | ~280 | C++ | TouchDesigner plugin. Worth keeping the README as evidence Kinect-360 works on arm64 if we ever add a depth path. |
| `Kinect360-TouchDesigner-macOS-arm64 (1).zip` | **SKIP-DUP** | — | — | — | Identical md5 to base. Delete. |
| `Kinect360-TouchDesigner-macOS-arm64 (2).zip` | **SKIP-DUP** | — | — | — | Identical md5. Delete. |
| `shape-mapper-main (1).zip` | **SKIP-DUP** | — | — | — | Identical md5. Delete. |
| `shape-mapper-main (2).zip` | **SKIP-DUP** | — | — | — | Identical md5. Delete. |

## Summary counts
- **GOLD**: 4 (maptasticjs, p5.mapper, yoha, GazeTracking)
- **SILVER**: 4 (artyom.js, Gesture-Virtual-Mouse, XboxController, eyeLike)
- **REFERENCE**: 17
- **SKIP / SKIP-DUP**: 8 (4 duplicate zips + 4 off-topic)
