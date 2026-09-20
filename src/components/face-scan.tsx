"use client";

/* Face verification via face-api.js (tiny detector + 68 landmarks + recognition).
   Enroll: stores a 128-float descriptor in localStorage (never leaves the browser).
   Verify: live camera capture compared by euclidean distance (<= 0.50 = match).
   Works on localhost (camera requires a secure context; localhost qualifies). */

import { useCallback, useEffect, useRef, useState } from "react";

const MODEL_URL = "/face-models";
const DISTANCE_THRESHOLD = 0.5;

type Phase = "idle" | "loading" | "camera" | "scanning" | "success" | "failure" | "error";

interface FaceApi {
  nets: {
    tinyFaceDetector: { loadFromUri: (u: string) => Promise<void>; isLoaded?: boolean };
    faceLandmark68TinyNet: { loadFromUri: (u: string) => Promise<void>; isLoaded?: boolean };
    faceRecognitionNet: { loadFromUri: (u: string) => Promise<void>; isLoaded?: boolean };
  };
  TinyFaceDetectorOptions: new (o: { inputSize: number; scoreThreshold: number }) => unknown;
  detectSingleFace: (input: HTMLVideoElement, opts: unknown) => {
    // NOTE: the landmark net must be passed explicitly — with no argument the
    // library defaults to the FULL FaceLandmark68Net and throws
    // "load model before inference" because only the tiny weights ship.
    withFaceLandmarks: (net?: unknown) => { withFaceDescriptor: () => Promise<{ descriptor: Float32Array } | undefined> };
  };
  euclideanDistance: (a: Float32Array, b: Float32Array) => number;
}

function descriptorKey(email: string) {
  return `cl_face_descriptor_${email.toLowerCase()}`;
}

export function FaceScan({
  email,
  mode,
  onSuccess,
  onCancel
}: {
  email: string;
  mode: "enroll" | "verify";
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceApiRef = useRef<FaceApi | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [distance, setDistance] = useState<number | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const loadModels = useCallback(async () => {
    if (faceApiRef.current) return; // already loaded — never load twice
    setPhase("loading");
    setMessage("Loading face models…");
    const faceapi = (await import("@vladmandic/face-api")) as unknown as FaceApi;
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceApiRef.current = faceapi;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("error");
        setMessage("Camera needs a secure context — open the site over HTTPS (or localhost). This preview browser context is not secure.");
        return;
      }
      await loadModels();
      setMessage("Requesting camera…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // Wait for real frames before declaring the camera ready — avoids the
        // black-video flash and ensures pixels exist for detection.
        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) return resolve();
          video.onloadeddata = () => resolve();
          setTimeout(resolve, 4000); // never hang forever on flaky cameras
        });
        await video.play().catch(() => { /* autoplay guard — muted+playsInline already set */ });
      }
      setPhase("camera");
      setMessage(mode === "enroll" ? "Look straight at the camera, then press Capture." : "Position your face and press Scan.");
    } catch (e) {
      setPhase("error");
      setMessage(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : e instanceof Error && e.name === "NotFoundError"
          ? "No camera found on this device."
          : "Could not start the camera. Check that no other app is using it."
      );
    }
  }, [loadModels, mode]);

  async function capture() {
    const faceapi = faceApiRef.current;
    const video = videoRef.current;
    if (!faceapi || !video) return;
    setPhase("scanning");
    setMessage(mode === "enroll" ? "Creating your face template…" : "Verifying…");
    try {
      const result = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks(faceapi.nets.faceLandmark68TinyNet)
        .withFaceDescriptor();
      if (!result) {
        setPhase("camera");
        setMessage("No face detected — move closer, ensure good lighting, and try again.");
        return;
      }
      if (mode === "enroll") {
        localStorage.setItem(descriptorKey(email), JSON.stringify(Array.from(result.descriptor)));
        stopCamera();
        setPhase("success");
        setMessage("Face enrolled on this device.");
        setTimeout(onSuccess, 900);
        return;
      }
      const storedRaw = localStorage.getItem(descriptorKey(email));
      if (!storedRaw) {
        stopCamera();
        setPhase("failure");
        setMessage("No face template enrolled on this device yet — enroll first.");
        return;
      }
      const stored = new Float32Array(JSON.parse(storedRaw) as number[]);
      const dist = faceapi.euclideanDistance(stored, result.descriptor);
      setDistance(dist);
      stopCamera();
      if (dist <= DISTANCE_THRESHOLD) {
        setPhase("success");
        setMessage(`Face verified (match distance ${dist.toFixed(3)}).`);
        setTimeout(onSuccess, 900);
      } else {
        setPhase("failure");
        setMessage(`Face did not match (distance ${dist.toFixed(3)} > ${DISTANCE_THRESHOLD}). Try again.`);
      }
    } catch {
      setPhase("camera");
      setMessage("Scan failed — try again.");
    }
  }

  const busy = phase === "loading" || phase === "scanning";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/40 p-4" role="dialog" aria-modal="true" aria-label={mode === "enroll" ? "Enroll face" : "Face verification"}>
      <div className="w-full max-w-md rounded-card border border-ash bg-surface p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-lg">
              {mode === "enroll" ? "Enroll your face" : "Face verification"}
            </h2>
            <p className="text-xs text-smoke mt-0.5">
              {mode === "enroll"
                ? "Your face template stays in this browser — never uploaded."
                : `Verifying ${email} on this device.`}
            </p>
          </div>
          <button onClick={() => { stopCamera(); onCancel(); }} aria-label="Cancel"
            className="text-smoke hover:text-offblack text-lg leading-none px-1">×</button>
        </div>

        <div className="relative aspect-[4/3] rounded-input overflow-hidden bg-canvas border border-ash">
          <video ref={videoRef} muted playsInline autoPlay className="w-full h-full object-cover" />
          {phase === "idle" && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-graphite">
              Camera off
            </div>
          )}
          {(phase === "camera" || phase === "scanning") && (
            <div className="absolute inset-4 border-2 border-lake/40 rounded-[50%] pointer-events-none" aria-hidden />
          )}
          {phase === "success" && (
            <div className="absolute inset-0 bg-emerald-600/85 flex items-center justify-center text-white font-medium">✓ Verified</div>
          )}
          {phase === "failure" && (
            <div className="absolute inset-0 bg-red-600/85 flex items-center justify-center text-white font-medium">Not verified</div>
          )}
        </div>

        <p className={`text-sm ${phase === "failure" ? "text-red-600" : phase === "success" ? "text-emerald-700" : "text-graphite"}`} role="status">
          {message}
        </p>
        {distance !== null && phase === "failure" && (
          <p className="text-xs text-smoke">Tip: retry in better lighting. Threshold is {DISTANCE_THRESHOLD}.</p>
        )}

        <div className="flex gap-3">
          {(phase === "idle" || phase === "error" || phase === "failure") && (
            <button onClick={phase === "idle" ? startCamera : () => { setPhase("idle"); setMessage(""); void startCamera(); }}
              disabled={busy}
              className="flex-1 rounded-pill bg-lake text-white text-sm py-2.5 hover:bg-lake-hover disabled:opacity-50">
              {phase === "idle" ? "Start camera" : "Try again"}
            </button>
          )}
          {phase === "camera" && (
            <button onClick={capture} disabled={busy}
              className="flex-1 rounded-pill bg-lake text-white text-sm py-2.5 hover:bg-lake-hover disabled:opacity-50">
              {mode === "enroll" ? "Capture face template" : "Scan my face"}
            </button>
          )}
          <button onClick={() => { stopCamera(); onCancel(); }}
            className="rounded-pill border border-ash px-5 py-2.5 text-sm hover:bg-lake-tint">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Has a face template been enrolled for this email on this device? */
export function isFaceEnrolled(email: string): boolean {
  try { return !!localStorage.getItem(descriptorKey(email)); } catch { return false; }
}

/** Remove the stored template (used on sign-out for privacy). */
export function clearFaceEnrollment(email: string): void {
  try { localStorage.removeItem(descriptorKey(email)); } catch { /* ignore */ }
}
