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
    hint: "Face the camera directly and blink naturally."
  },
  {
    id: "left",
    title: "Step 2 of 4: Turn Slightly Left",
    hint: "Turn your head gently to the left."
  },
  {
    id: "right",
    title: "Step 3 of 4: Turn Slightly Right",
    hint: "Turn your head gently to the right."
  },
  {
    id: "tilt",
    title: "Step 4 of 4: Tilt Slightly Up / Down",
    hint: "Nod slightly up or down while keeping your face visible."
  }
];


const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.25
});


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

  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [poseIndex, setPoseIndex] = useState(0);
  const [capturedPoses, setCapturedPoses] = useState([]);
  const [error, setError] = useState("");


  // Reset state whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPoseIndex(0);
    setCapturedPoses([]);
    setFaceDetected(false);
    setError("");
    setProcessing(false);
    busyRef.current = false;
    autoDoneRef.current = false;
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


  // Continuous fast face detection loop + auto-verify in verify mode
  useEffect(() => {
    if (!isOpen || !cameraReady || !modelsReady) return;

    let cancelled = false;
    const intervalId = setInterval(async () => {
      if (cancelled || busyRef.current || autoDoneRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      try {
        const det = await faceapi.detectSingleFace(video, DETECTOR_OPTIONS);
        if (cancelled) return;
        const found = Boolean(det);
        setFaceDetected(found);

        // In verify mode, auto-capture as soon as a clear face is seen
        if (found && mode === "verify" && !autoDoneRef.current) {
          await captureSingleFrame(true);
        }
      } catch {
        // Ignore transient frame errors
      }
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isOpen, cameraReady, modelsReady, mode, poseIndex]);


  async function captureSingleFrame(isAuto = false) {
    if (!videoRef.current || !modelsReady || !cameraReady || busyRef.current) {
      return;
    }

    busyRef.current = true;
    setProcessing(true);
    if (!isAuto) setError("");

    try {
      const video = videoRef.current;
      const detection = await faceapi
        .detectSingleFace(video, DETECTOR_OPTIONS)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection) {
        if (!isAuto) {
          setError(
            "Face not clearly visible. Move closer, face the light, and try again."
          );
        }
        return;
      }

      const descriptorArray = Array.from(detection.descriptor).map((v) =>
        Number(v.toFixed(6))
      );

      if (mode === "verify") {
        autoDoneRef.current = true;
        const backgroundSignature = extractBackgroundSignatureFromSource(
          video,
          detection.detection.box
        );
        await onCapture({
          faceDescriptor: descriptorArray,
          backgroundSignature
        });
        return;
      }

      // Registration multi-pose collection
      const nextPoses = [...capturedPoses, descriptorArray];
      setCapturedPoses(nextPoses);

      if (nextPoses.length < REGISTRATION_POSES.length) {
        setPoseIndex(nextPoses.length);
      } else {
        autoDoneRef.current = true;
        await onCapture(nextPoses);
      }
    } catch (err) {
      autoDoneRef.current = false;
      setError(err.message || "Facial capture failed.");
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  }


  if (!isOpen) return null;

  const currentPose = REGISTRATION_POSES[poseIndex] || REGISTRATION_POSES[0];

  const heading =
    title ||
    (mode === "register"
      ? "Register Facial Data (Multi-Pose)"
      : "Verify Face & Classroom");

  const description =
    subtitle ||
    (mode === "register"
      ? `${currentPose.title} — ${currentPose.hint}`
      : "Location verified! Blink and look straight at the camera for automatic verification.");


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
                    idx < capturedPoses.length
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

            {/* Live face detection pill */}
            {cameraReady && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-slate-900/75 px-3 py-1 text-xs font-semibold text-white">
                {faceDetected ? (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span className="text-emerald-300">Face Detected</span>
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
                  faceDetected ? "border-emerald-400" : "border-blue-400/80"
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
              onClick={() => captureSingleFrame(false)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Camera size={16} />
              {processing
                ? "Verifying..."
                : mode === "register"
                ? `Capture Pose ${poseIndex + 1}/4`
                : "Verify Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
