import { useEffect, useRef, useState } from "react";
import * as faceapi from "@vladmandic/face-api";
import {
  Camera,
  X,
  LoaderCircle,
  ScanFace,
  AlertCircle,
  CheckCircle2
} from "lucide-react";

import { extractBackgroundSignatureFromSource } from "../lib/backgroundSignature";


let modelsLoadedPromise = null;

export function preloadFaceModels() {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models")
    ]).catch((err) => {
      modelsLoadedPromise = null;
      throw err;
    });
  }
  return modelsLoadedPromise;
}


const REGISTRATION_POSES = [
  {
    id: "straight",
    title: "Step 1 of 4: Look Straight & Blink",
    hint: "Look directly at the camera."
  },
  {
    id: "left",
    title: "Step 2 of 4: Turn Head Left",
    hint: "Turn your head slightly to your left."
  },
  {
    id: "right",
    title: "Step 3 of 4: Turn Head Right",
    hint: "Turn your head slightly to your right."
  },
  {
    id: "tilt",
    title: "Step 4 of 4: Tilt Up or Down",
    hint: "Tilt your chin slightly up or down."
  }
];


const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.22
});


function avgPoint(points) {
  const n = points.length || 1;
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / n, y: sum.y / n };
}


/**
 * Estimates head orientation ("straight" | "left" | "right" | "tilt")
 * from 68-point facial landmarks.
 * Note: Video preview is mirrored (-scale-x-100), so turning to the user's left
 * shifts the nose tip toward +x in raw camera coordinates.
 */
function detectHeadOrientation(landmarks) {
  const leftEye = avgPoint(landmarks.getLeftEye());
  const rightEye = avgPoint(landmarks.getRightEye());
  const nosePts = landmarks.getNose();
  const noseTip = nosePts[3] || avgPoint(nosePts);
  const mouth = avgPoint(landmarks.getMouth());

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const eyeDist = Math.max(
    12,
    Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y)
  );
  const eyeToMouthY = Math.max(12, mouth.y - eyeMidY);

  const yaw = (noseTip.x - eyeMidX) / eyeDist;
  const pitch = (noseTip.y - eyeMidY) / eyeToMouthY;

  if (yaw >= 0.14) return "left";
  if (yaw <= -0.14) return "right";
  if (pitch <= 0.43 || pitch >= 0.67) return "tilt";
  return "straight";
}


const POSE_LABELS = {
  straight: "Looking Straight",
  left: "Turned Left",
  right: "Turned Right",
  tilt: "Tilted Up / Down"
};


export default function FaceCaptureModal({
  isOpen,
  mode = "register", // "register" | "verify"
  title,
  subtitle,
  onClose,
  onCapture
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const busyRef = useRef(false);
  const autoDoneRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const lastValidDescriptorRef = useRef(null);
  const lastValidBoxRef = useRef(null);
  const posesRef = useRef([]);

  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [detectedOrientation, setDetectedOrientation] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [poseIndex, setPoseIndex] = useState(0);
  const [capturedCount, setCapturedCount] = useState(0);
  const [error, setError] = useState("");


  // Reset state whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPoseIndex(0);
    setCapturedCount(0);
    setFaceDetected(false);
    setDetectedOrientation(null);
    setError("");
    setProcessing(false);
    busyRef.current = false;
    autoDoneRef.current = false;
    cooldownUntilRef.current = 0;
    lastValidDescriptorRef.current = null;
    lastValidBoxRef.current = null;
    posesRef.current = [];
  }, [isOpen, mode]);


  // Start camera & load models IN PARALLEL so camera opens immediately
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setCameraReady(false);
    setError("");

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      if (!active) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (active) setCameraReady(true);
      }
    };

    const loadModels = async () => {
      await preloadFaceModels();
      if (active) setModelsReady(true);
    };

    Promise.all([startCamera(), loadModels()]).catch((err) => {
      if (active) {
        setError(err.message || "Unable to access camera or load face models.");
      }
    });

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen]);


  async function submitFinalRegistration(posesArray) {
    autoDoneRef.current = true;
    setProcessing(true);
    setError("");
    try {
      await onCapture(posesArray);
    } catch (err) {
      autoDoneRef.current = false;
      setError(err.message || "Failed to save facial data.");
    } finally {
      setProcessing(false);
    }
  }


  async function submitVerification(descriptorArray, box) {
    autoDoneRef.current = true;
    setProcessing(true);
    setError("");
    try {
      const backgroundSignature = extractBackgroundSignatureFromSource(
        videoRef.current,
        box
      );
      await onCapture({
        faceDescriptor: descriptorArray,
        backgroundSignature
      });
    } catch (err) {
      autoDoneRef.current = false;
      setError(err.message || "Verification failed.");
    } finally {
      setProcessing(false);
    }
  }


  // Continuous landmark + orientation + descriptor loop
  useEffect(() => {
    if (!isOpen || !cameraReady || !modelsReady) return;

    let cancelled = false;

    const runLoop = async () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 2 &&
        !busyRef.current &&
        !autoDoneRef.current
      ) {
        busyRef.current = true;
        try {
          const detection = await faceapi
            .detectSingleFace(video, DETECTOR_OPTIONS)
            .withFaceLandmarks(true)
            .withFaceDescriptor();

          if (!cancelled) {
            if (detection) {
              const descriptorArray = Array.from(detection.descriptor).map(
                (v) => Number(v.toFixed(6))
              );
              const orientation = detectHeadOrientation(detection.landmarks);

              lastValidDescriptorRef.current = descriptorArray;
              lastValidBoxRef.current = detection.detection.box;
              setFaceDetected(true);
              setDetectedOrientation(orientation);

              if (mode === "verify") {
                await submitVerification(
                  descriptorArray,
                  detection.detection.box
                );
              } else if (Date.now() >= cooldownUntilRef.current) {
                const currentIdx = posesRef.current.length;
                const expectedPose = REGISTRATION_POSES[currentIdx]?.id;

                if (expectedPose && orientation === expectedPose) {
                  const nextPoses = [...posesRef.current, descriptorArray];
                  posesRef.current = nextPoses;
                  setCapturedCount(nextPoses.length);
                  cooldownUntilRef.current = Date.now() + 650;

                  if (nextPoses.length < REGISTRATION_POSES.length) {
                    setPoseIndex(nextPoses.length);
                  } else {
                    await submitFinalRegistration(nextPoses);
                  }
                }
              }
            } else {
              setFaceDetected(false);
              setDetectedOrientation(null);
            }
          }
        } catch {
          // Ignore transient frame errors
        } finally {
          busyRef.current = false;
        }
      }

      if (!cancelled) {
        setTimeout(runLoop, 180);
      }
    };

    const timerId = setTimeout(runLoop, 180);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [isOpen, cameraReady, modelsReady, mode]);


  async function handleManualCapture() {
    if (!modelsReady || !cameraReady || processing) return;

    // If all 4 poses were already captured and API save failed, retry saving directly
    if (
      mode === "register" &&
      posesRef.current.length >= REGISTRATION_POSES.length
    ) {
      await submitFinalRegistration(posesRef.current);
      return;
    }

    setError("");

    // Use the latest valid descriptor if the live frame is momentarily obscured
    const cachedDescriptor = lastValidDescriptorRef.current;
    const cachedBox = lastValidBoxRef.current;

    if (mode === "verify") {
      if (cachedDescriptor && cachedBox) {
        await submitVerification(cachedDescriptor, cachedBox);
        return;
      }
      setError("No face detected yet. Look directly at the camera in good lighting.");
      return;
    }

    // Registration manual fallback for current pose
    if (!cachedDescriptor) {
      setError("No face detected yet. Center your face inside the oval.");
      return;
    }

    const expectedPose = REGISTRATION_POSES[posesRef.current.length]?.id;
    if (
      detectedOrientation &&
      expectedPose &&
      detectedOrientation !== expectedPose
    ) {
      setError(
        `Please ${REGISTRATION_POSES[posesRef.current.length].hint.toLowerCase()} (currently: ${POSE_LABELS[detectedOrientation]}).`
      );
      return;
    }

    const nextPoses = [...posesRef.current, cachedDescriptor];
    posesRef.current = nextPoses;
    setCapturedCount(nextPoses.length);

    if (nextPoses.length < REGISTRATION_POSES.length) {
      setPoseIndex(nextPoses.length);
    } else {
      await submitFinalRegistration(nextPoses);
    }
  }


  if (!isOpen) return null;

  const currentPose = REGISTRATION_POSES[poseIndex] || REGISTRATION_POSES[0];
  const expectedPoseId = currentPose.id;
  const orientationMatched =
    mode === "register" &&
    faceDetected &&
    detectedOrientation === expectedPoseId;

  const heading =
    title ||
    (mode === "register"
      ? "Register Facial Data (Multi-Pose)"
      : "Verify Face & Classroom");

  const description =
    subtitle ||
    (mode === "register"
      ? `${currentPose.title} — ${currentPose.hint}`
      : "Location verified! Look straight at the camera for automatic verification.");


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <ScanFace size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{heading}</h3>
              <p className="text-xs text-slate-500">
                {mode === "register"
                  ? `Pose ${Math.min(poseIndex + 1, REGISTRATION_POSES.length)} of ${REGISTRATION_POSES.length}`
                  : "Step 2 of 2: Face & Background Check"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-xs font-medium text-blue-900">
            {description}
          </div>

          {mode === "register" && (
            <div className="grid grid-cols-4 gap-1.5">
              {REGISTRATION_POSES.map((p, idx) => (
                <div
                  key={p.id}
                  className={`h-1.5 rounded-full transition ${
                    idx < capturedCount
                      ? "bg-emerald-500"
                      : idx === poseIndex
                      ? "bg-blue-600"
                      : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
          )}

          <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-slate-950">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full -scale-x-100 object-cover"
            />

            {/* Live face + head orientation pill */}
            {cameraReady && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white">
                {faceDetected ? (
                  <>
                    <CheckCircle2
                      size={14}
                      className={
                        orientationMatched || mode === "verify"
                          ? "text-emerald-400"
                          : "text-blue-400"
                      }
                    />
                    <span
                      className={
                        orientationMatched || mode === "verify"
                          ? "text-emerald-300"
                          : "text-blue-200"
                      }
                    >
                      {detectedOrientation
                        ? POSE_LABELS[detectedOrientation]
                        : "Face Detected"}
                    </span>
                  </>
                ) : (
                  <>
                    <LoaderCircle size={13} className="animate-spin text-amber-300" />
                    <span className="text-amber-200">
                      {modelsReady ? "Looking for face..." : "Loading AI models..."}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Face guide overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-48 w-36 rounded-full border-2 border-dashed transition ${
                  orientationMatched || (mode === "verify" && faceDetected)
                    ? "border-emerald-400"
                    : faceDetected
                    ? "border-blue-400"
                    : "border-slate-400/70"
                }`}
              />
            </div>

            {!cameraReady && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white">
                <LoaderCircle className="animate-spin text-blue-400" size={28} />
                <p className="mt-2 text-xs">Opening camera...</p>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={!modelsReady || !cameraReady || processing}
              onClick={handleManualCapture}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Camera size={16} />
              {processing
                ? "Saving..."
                : mode === "register"
                ? capturedCount >= REGISTRATION_POSES.length
                  ? "Retry Save"
                  : `Capture Pose ${poseIndex + 1}/4`
                : "Verify Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
