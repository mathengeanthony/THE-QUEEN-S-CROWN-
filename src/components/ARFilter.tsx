import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, FlipHorizontal, Download, X, Loader2 } from 'lucide-react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const crownSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">
  <defs>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFDF00" />
      <stop offset="50%" stop-color="#D4AF37" />
      <stop offset="100%" stop-color="#996515" />
    </linearGradient>
  </defs>
  <path d="M 20 130 Q 100 145 180 130 L 190 110 Q 100 125 10 110 Z" fill="url(#gold)" stroke="#8B6508" stroke-width="2"/>
  <path d="M 10 110 L 5 30 L 45 75 L 100 10 L 155 75 L 195 30 L 190 110 Q 100 125 10 110 Z" fill="url(#gold)" stroke="#8B6508" stroke-width="2"/>
  <circle cx="5" cy="30" r="8" fill="#FF1493" stroke="#C71585" stroke-width="1"/>
  <circle cx="100" cy="10" r="12" fill="#00FFFF" stroke="#008B8B" stroke-width="1"/>
  <circle cx="195" cy="30" r="8" fill="#FF1493" stroke="#C71585" stroke-width="1"/>
  <circle cx="45" cy="75" r="6" fill="#32CD32" stroke="#228B22" stroke-width="1"/>
  <circle cx="155" cy="75" r="6" fill="#32CD32" stroke="#228B22" stroke-width="1"/>
  <circle cx="50" cy="120" r="5" fill="#9400D3"/>
  <circle cx="100" cy="123" r="7" fill="#FF0000"/>
  <circle cx="150" cy="120" r="5" fill="#9400D3"/>
</svg>`;

const crownImage = new Image();
crownImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(crownSvg)}`;

export default function ARFilter() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>();
  const lastVideoTimeRef = useRef<number>(-1);

  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Initialize MediaPipe
  useEffect(() => {
    let isMounted = true;
    const initModel = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1
        });
        if (isMounted) {
          faceLandmarkerRef.current = landmarker;
          setIsModelLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load MediaPipe model:", err);
      }
    };
    initModel();

    return () => {
      isMounted = false;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
      }
    };
  }, []);

  // Initialize Camera
  useEffect(() => {
    let isMounted = true;
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        
        if (isMounted && videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (e: any) {
            if (e.name !== 'AbortError') {
              console.error("Video play error:", e);
            }
          }
          setHasPermission(true);
        } else {
          // Stop tracks if component unmounted while waiting for stream
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (err) {
        console.error("Camera permission denied or error:", err);
        if (isMounted) {
          setHasPermission(false);
        }
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [facingMode]);

  // Render Loop
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !faceLandmarkerRef.current || video.readyState < 2) {
      requestRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize canvas to match window
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    if (lastVideoTimeRef.current !== video.currentTime) {
      lastVideoTimeRef.current = video.currentTime;
      const results = faceLandmarkerRef.current.detectForVideo(video, performance.now());

      // Calculate object-fit: cover dimensions
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;
      let drawWidth, drawHeight, startX, startY;

      if (videoRatio > canvasRatio) {
        drawHeight = canvas.height;
        drawWidth = canvas.height * videoRatio;
        startX = (canvas.width - drawWidth) / 2;
        startY = 0;
      } else {
        drawWidth = canvas.width;
        drawHeight = canvas.width / videoRatio;
        startX = 0;
        startY = (canvas.height - drawHeight) / 2;
      }

      ctx.save();
      
      // Mirror if front camera
      if (facingMode === 'user') {
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
      }

      // Draw Video
      ctx.drawImage(video, startX, startY, drawWidth, drawHeight);

      // Draw Crown
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];

        const mapLandmark = (lm: { x: number, y: number }) => ({
          x: startX + lm.x * drawWidth,
          y: startY + lm.y * drawHeight
        });

        const leftEye = mapLandmark(landmarks[33]);
        const rightEye = mapLandmark(landmarks[263]);
        const forehead = mapLandmark(landmarks[10]);
        const leftCheek = mapLandmark(landmarks[234]);
        const rightCheek = mapLandmark(landmarks[454]);

        const faceWidth = Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y);
        const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

        const crownWidth = faceWidth * 1.8;
        const crownHeight = crownWidth * 0.75;

        ctx.translate(forehead.x, forehead.y);
        ctx.rotate(angle);
        
        // Offset the crown so it sits nicely on the head
        ctx.drawImage(crownImage, -crownWidth / 2, -crownHeight * 1.1, crownWidth, crownHeight);
      }
      ctx.restore();
    }
    requestRef.current = requestAnimationFrame(draw);
  }, [facingMode]);

  useEffect(() => {
    if (isModelLoaded && hasPermission) {
      requestRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isModelLoaded, hasPermission, draw]);

  const takeSnapshot = () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.9);
      setCapturedImage(dataUrl);
    }
  };

  const downloadSnapshot = () => {
    if (capturedImage) {
      const link = document.createElement('a');
      link.href = capturedImage;
      link.download = 'queens-crown-snap.jpg';
      link.click();
    }
  };

  if (hasPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-900 text-white p-6 text-center">
        <Camera className="w-16 h-16 mb-4 text-zinc-500" />
        <h2 className="text-2xl font-bold mb-2">Camera Access Required</h2>
        <p className="text-zinc-400 max-w-md">
          Please allow camera access in your browser to use the AR filter.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Hidden Video Element */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        autoPlay
        muted
      />

      {/* Main AR Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Loading Overlay */}
      {!isModelLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm text-white z-10">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-yellow-400" />
          <p className="text-lg font-medium tracking-wide">Loading AR Filter...</p>
        </div>
      )}

      {/* UI Overlay */}
      {isModelLoaded && !capturedImage && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between p-6 pointer-events-none">
          {/* Top Bar */}
          <div className="flex justify-end w-full pointer-events-auto">
            <button
              onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
              className="p-3 bg-black/30 hover:bg-black/50 backdrop-blur-md rounded-full text-white transition-all active:scale-95"
            >
              <FlipHorizontal className="w-6 h-6" />
            </button>
          </div>

          {/* Bottom Bar */}
          <div className="flex justify-center w-full pb-8 pointer-events-auto">
            <button
              onClick={takeSnapshot}
              className="w-20 h-20 rounded-full border-[6px] border-white bg-white/20 hover:bg-white/40 transition-all active:scale-90 flex items-center justify-center shadow-lg"
            >
              <div className="w-16 h-16 rounded-full border-2 border-white/50" />
            </button>
          </div>
        </div>
      )}

      {/* Captured Image Modal */}
      {capturedImage && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col">
          <img src={capturedImage} alt="Captured snap" className="w-full h-full object-cover" />
          
          <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start bg-gradient-to-b from-black/50 to-transparent">
            <button
              onClick={() => setCapturedImage(null)}
              className="p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all active:scale-95"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-8 flex justify-center bg-gradient-to-t from-black/80 to-transparent">
            <button
              onClick={downloadSnapshot}
              className="flex items-center gap-2 px-8 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-full shadow-lg transition-all active:scale-95"
            >
              <Download className="w-5 h-5" />
              Save Snap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
