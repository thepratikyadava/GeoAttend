import { useEffect, useRef, useState } from "react";
import * as faceapi from "@vladmandic/face-api";
import { Camera, X, LoaderCircle, ScanFace, AlertCircle } from "lucide-react";


let modelsLoadedPromise = null;

function ensureFaceModelsLoaded() {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models")
    ]);
  }
  return modelsLoadedPromise;
}


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

  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");


  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setError("");
    setCameraReady(false);

    async function setup() {
      try {
        await ensureFaceModelsLoaded();
        if (!active) return;
        setModelsReady(true);

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
          setCameraReady(true);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Unable to access camera or load face models.");
        }
      }
    }

    setup();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen]);


  async function handleCaptureClick() {
    if (!videoRef.current || !modelsReady || !cameraReady) return;

    setError("");
    setProcessing(true);

    try {
      const detection = await faceapi
        .detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5
          })
        )
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection) {
        setError(
          "No clear face detected. Center your face in good lighting and try again."
        );
        setProcessing(false);
        return;
      }

      const descriptorArray = Array.from(detection.descriptor).map((v) =>
        Number(v.toFixed(6))
      );

      await onCapture(descriptorArray);
    } catch (err) {
      setError(err.message || "Facial capture failed.");
    } finally {
      setProcessing(false);
    }
  }


  if (!isOpen) return null;

  const heading =
    title ||
    (mode === "register"
      ? "Register Facial Data"
      : "Verify Your Face");

  const description =
    subtitle ||
    (mode === "register"
      ? "Position your face clearly in the frame to save your Face ID for attendance."
      : "Location verified inside boundary! Now scan your face to confirm attendance.");


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
                {mode === "register" ? "Step: Face ID Setup" : "Step 2 of 2: Biometric Check"}
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
          <p className="text-xs text-slate-600">{description}</p>

          <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-slate-950">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full -scale-x-100 object-cover"
            />

            {/* Face guide overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-36 rounded-full border-2 border-dashed border-blue-400/80" />
            </div>

            {(!modelsReady || !cameraReady) && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white">
                <LoaderCircle className="animate-spin text-blue-400" size={28} />
                <p className="mt-2 text-xs">
                  {!modelsReady ? "Loading facial recognition models..." : "Starting camera..."}
                </p>
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
              onClick={handleCaptureClick}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Camera size={16} />
              {processing
                ? "Scanning..."
                : mode === "register"
                ? "Capture & Save Face"
                : "Verify & Mark Present"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
