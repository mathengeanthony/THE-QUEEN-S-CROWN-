import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, FlipHorizontal, Download, X, Loader2 } from 'lucide-react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

const emojis = ['❤️', '🔥', '🌍', '🪭', '🎶', '🎺', '🪇', '🥁', '🫧', '💠', '✨️', '🌀', '🍍', '🥭', '🍇', '🍯', '🦋', '🐞', '🌼', '🐙'];

const FloatingEmojis = () => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {[...Array(25)].map((_, i) => (
        <div
          key={i}
          className="absolute animate-float opacity-80"
          style={{
            left: `${Math.random() * 100}%`,
            animationDuration: `${Math.random() * 4 + 3}s`,
            animationDelay: `${Math.random() * 3}s`,
            fontSize: `${Math.random() * 24 + 20}px`
          }}
        >
          {emojis[Math.floor(Math.random() * emojis.length)]}
        </div>
      ))}
    </div>
  );
};

export default function ARFilter() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>();
  const lastVideoTimeRef = useRef<number>(-1);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const crownModelRef = useRef<THREE.Object3D | null>(null);

  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>('/crown.glb');

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
      } catch (err: any) {
        console.error("Failed to load MediaPipe model:", err);
        if (isMounted) setLoadError(err.message || "Failed to load AR model");
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

  // Initialize Three.js
  useEffect(() => {
    if (!webglCanvasRef.current) return;
    
    const width = window.innerWidth;
    const height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, width, height, 0, -2000, 2000);
    camera.position.z = 1000;

    const renderer = new THREE.WebGLRenderer({ 
      canvas: webglCanvasRef.current, 
      alpha: true, 
      antialias: true 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.right = w;
      camera.bottom = h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // Load GLB Model
  useEffect(() => {
    if (!glbUrl || !sceneRef.current) return;

    // Check if the file exists and isn't the HTML fallback (SPA routing)
    fetch(glbUrl, { method: 'HEAD' })
      .then(response => {
        const contentType = response.headers.get('content-type');
        if (response.ok && contentType && !contentType.includes('text/html')) {
          const loader = new GLTFLoader();
          loader.load(glbUrl, (gltf) => {
            if (crownModelRef.current) {
              sceneRef.current?.remove(crownModelRef.current);
            }
            const model = gltf.scene;
            
            // Center the model's geometry
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            
            // Offset all children so the bounding box center is at (0,0,0)
            model.children.forEach(child => {
              child.position.sub(center);
            });
            
            // Calculate new size after centering
            const newBox = new THREE.Box3().setFromObject(model);
            const size = newBox.getSize(new THREE.Vector3());
            model.userData.baseScale = size.x || 1;
            
            // Move the model up slightly so the bottom sits on the forehead, not the center
            model.userData.yOffset = size.y / 2;

            sceneRef.current?.add(model);
            crownModelRef.current = model;
          }, undefined, (error) => {
            console.warn("Could not load custom 3D crown, falling back to 2D crown.", error);
          });
        } else {
          console.log("No custom crown.glb found. Using default 2D crown.");
        }
      })
      .catch(() => {
        console.log("Could not check for crown.glb. Using default 2D crown.");
      });
  }, [glbUrl]);

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

    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    if (lastVideoTimeRef.current !== video.currentTime) {
      lastVideoTimeRef.current = video.currentTime;
      const results = faceLandmarkerRef.current.detectForVideo(video, performance.now());

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
      
      if (facingMode === 'user') {
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
      }

      ctx.drawImage(video, startX, startY, drawWidth, drawHeight);

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

        if (glbUrl && crownModelRef.current && cameraRef.current && rendererRef.current && sceneRef.current) {
          // 3D Crown Logic
          crownModelRef.current.visible = true;
          
          const baseScale = crownModelRef.current.userData.baseScale || 1;
          const targetScale = (faceWidth * 1.8) / baseScale;
          crownModelRef.current.scale.set(targetScale, targetScale, targetScale);

          // Apply yOffset so the bottom of the crown sits on the forehead
          const yOffset = (crownModelRef.current.userData.yOffset || 0) * targetScale;
          const threeY = canvas.height - forehead.y + yOffset;
          
          crownModelRef.current.position.set(forehead.x, threeY, 0);

          // Approximate rotation
          const yaw = (landmarks[33].z - landmarks[263].z) * 2.0;
          const pitch = (landmarks[10].z - landmarks[1].z) * 2.0;
          
          crownModelRef.current.rotation.set(pitch, yaw, -angle);
        } else {
          // 2D Crown Fallback
          const crownWidth = faceWidth * 1.8;
          const crownHeight = crownWidth * 0.75;

          ctx.translate(forehead.x, forehead.y);
          ctx.rotate(angle);
          
          ctx.shadowColor = 'rgba(255, 105, 180, 0.8)';
          ctx.shadowBlur = 25;
          
          ctx.drawImage(crownImage, -crownWidth / 2, -crownHeight * 1.1, crownWidth, crownHeight);
          
          ctx.shadowBlur = 0;
        }
      } else {
        if (crownModelRef.current) {
          crownModelRef.current.visible = false;
        }
      }
      
      ctx.restore();

      // Render 3D scene if active
      if (glbUrl && rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    }
    requestRef.current = requestAnimationFrame(draw);
  }, [facingMode, glbUrl]);

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
      const combinedCanvas = document.createElement('canvas');
      combinedCanvas.width = canvasRef.current.width;
      combinedCanvas.height = canvasRef.current.height;
      const ctx = combinedCanvas.getContext('2d');
      
      if (ctx) {
        // Draw 2D canvas (video + fallback crown)
        ctx.drawImage(canvasRef.current, 0, 0);
        
        // Draw 3D canvas if active
        if (glbUrl && webglCanvasRef.current) {
          if (facingMode === 'user') {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.translate(-combinedCanvas.width, 0);
            ctx.drawImage(webglCanvasRef.current, 0, 0);
            ctx.restore();
          } else {
            ctx.drawImage(webglCanvasRef.current, 0, 0);
          }
        }
        
        setCapturedImage(combinedCanvas.toDataURL('image/jpeg', 0.9));
      }
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
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />

      {/* Main AR Canvas (2D) */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover z-0" />

      {/* WebGL Canvas (3D) */}
      <canvas 
        ref={webglCanvasRef} 
        className="absolute inset-0 w-full h-full object-cover z-10 pointer-events-none"
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
      />

      {/* Loading Overlay */}
      {!isModelLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white z-50">
          {loadError ? (
            <div className="text-red-500 text-center p-6 bg-red-500/10 rounded-xl border border-red-500/30">
              <h2 className="text-xl font-bold mb-2">Error Loading AR</h2>
              <p>{loadError}</p>
            </div>
          ) : (
            <>
              <div className="relative">
                <Loader2 className="w-20 h-20 animate-spin text-pink-400 drop-shadow-[0_0_15px_rgba(244,114,182,0.8)]" />
                <div className="absolute inset-0 flex items-center justify-center text-3xl">👑</div>
              </div>
              <h1 className="mt-8 text-2xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-purple-300 to-pink-300 animate-pulse text-center px-6 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] leading-tight">
                A CROWN FOR THE MOST BEAUTIFUL PRINCESS EVER 💖✨
              </h1>
            </>
          )}
        </div>
      )}

      {/* UI Overlay */}
      {isModelLoaded && !capturedImage && (
        <>
          <FloatingEmojis />
          <div className="absolute inset-0 pointer-events-none border-[8px] border-purple-500/40 shadow-[inset_0_0_60px_30px_rgba(168,85,247,0.6)] z-20 mix-blend-screen" />

          <div className="absolute inset-0 z-20 flex flex-col justify-between p-6 pointer-events-none">
            {/* Top Bar */}
            <div className="flex justify-end w-full pointer-events-auto">
              <button
                onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
                className="p-3 bg-pink-500/30 hover:bg-pink-500/50 backdrop-blur-md rounded-full text-white transition-all active:scale-95 shadow-[0_0_15px_rgba(236,72,153,0.5)] border border-pink-300/50"
              >
                <FlipHorizontal className="w-6 h-6" />
              </button>
            </div>

            {/* Bottom Bar */}
            <div className="flex justify-center w-full pb-8 pointer-events-auto">
              <button
                onClick={takeSnapshot}
                className="w-24 h-24 rounded-full border-[4px] border-pink-300 bg-gradient-to-tr from-purple-500/40 to-pink-500/40 hover:from-purple-500/60 hover:to-pink-500/60 transition-all active:scale-90 flex items-center justify-center shadow-[0_0_30px_rgba(236,72,153,0.8)] backdrop-blur-sm"
              >
                <div className="w-16 h-16 rounded-full bg-white/90 shadow-[0_0_20px_rgba(255,255,255,0.9)] flex items-center justify-center text-2xl">
                  📸
                </div>
              </button>
            </div>
          </div>
        </>
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
              className="flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400 text-white font-bold rounded-full shadow-[0_0_20px_rgba(236,72,153,0.6)] transition-all active:scale-95"
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
