// demo.js — WebRTC + WebXR AR with receiver-side person segmentation
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js";
import { ARButton } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/webxr/ARButton.js";
import { PersonMatte } from "./personMatte.js";

const els = {
  myId: document.getElementById("myId"),
  copyBtn: document.getElementById("copyBtn"),
  remoteId: document.getElementById("remoteId"),
  callBtn: document.getElementById("callBtn"),
  startArBtn: document.getElementById("startArBtn"),
  muteBtn: document.getElementById("muteBtn"),
  hangupBtn: document.getElementById("hangupBtn"),
  status: document.getElementById("status"),
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
};

let peer, callConn;
let localStream, remoteStream;
let scene, camera, renderer, remotePlane, matte, matteTexture;
let isMuted = false;

log("initializing…");
await initMedia();
await initPeer();
initThree();

function log(msg){ els.status.textContent = `status: ${msg}`; console.log("[status]", msg); }

async function initMedia() {
  // audio ON — it’s a call.
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  els.localVideo.srcObject = localStream;
  els.localVideo.muted = true; // avoid echo locally
  await els.localVideo.play().catch(() => {}); // iOS may require a user gesture
  log("camera+mic ready");
}

async function initPeer() {
  const myId = readableId();
  els.myId.value = myId;

  // PeerJS — using default cloud PeerServer (okay for demo). Add TURN for real users.
  peer = new window.Peer(myId, {
    // config: { iceServers: [ { urls: "stun:stun.l.google.com:19302" }, /* add your TURN here */ ] }
  });

  peer.on("open", () => log(`online as ${myId}`));
  peer.on("error", err => { log(`peer error: ${err.type}`); console.error(err); });

  // inbound calls
  peer.on("call", (c) => {
    log("incoming call… answering");
    callConn = c;
    c.on("error", e => console.error("call error", e));
    c.on("close", () => endCall());

    c.answer(localStream);
    c.on("stream", (stream) => attachRemote(stream));
  });

  // ui
  els.copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(els.myId.value).catch(()=>{});
    log("copied id");
  };

  els.callBtn.onclick = () => {
    const rid = (els.remoteId.value || "").trim();
    if (!rid) return log("enter a remote id");
    log(`calling ${rid}…`);
    callConn = peer.call(rid, localStream);
    callConn.on("stream", (stream) => attachRemote(stream));
    callConn.on("close", () => endCall());
    callConn.on("error", e => console.error("call error", e));
  };

  els.hangupBtn.onclick = () => endCall();

  els.muteBtn.onclick = () => {
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    els.muteBtn.textContent = isMuted ? "unmute" : "mute";
  };

  els.startArBtn.onclick = async () => {
    // trigger a XR session via ARButton
    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ["hit-test"], optionalFeatures: [] }));
    try { await renderer.xr.setSession(await navigator.xr.requestSession("immersive-ar", { requiredFeatures: ["hit-test"] })); }
    catch (e) { log("webxr ar not available"); console.warn(e); }
  };
}

function attachRemote(stream) {
  remoteStream = stream;
  els.remoteVideo.srcObject = stream;
  els.remoteVideo.play().catch(()=>{});
  log("remote stream received");

  // Start receiver-side segmentation on the remote video
  matte = new PersonMatte(els.remoteVideo, { modelSelection: 1 });
  matte.start().then(() => {
    // Matte canvas -> CanvasTexture for AR
    matteTexture = new THREE.CanvasTexture(matte.canvas);
    matteTexture.premultiplyAlpha = true; // correct blending
    matteTexture.needsUpdate = true;

    if (!remotePlane) {
      const geometry = new THREE.PlaneGeometry(1, 1.5);
      const material = new THREE.MeshBasicMaterial({ map: matteTexture, transparent: true });
      remotePlane = new THREE.Mesh(geometry, material);
      remotePlane.position.set(0, 0, -2); // simple fixed placement (we'll add hit-test later)
      scene.add(remotePlane);
    } else {
      remotePlane.material.map = matteTexture;
      remotePlane.material.needsUpdate = true;
    }

    log("segmentation active");
  });
}

function endCall() {
  if (callConn) { try{ callConn.close(); }catch{} callConn = null; }
  if (remotePlane) { scene.remove(remotePlane); remotePlane.geometry.dispose(); remotePlane.material.dispose(); remotePlane = null; }
  if (matte) { matte.stop(); matte = null; }
  matteTexture = null;
  log("call ended");
}

// ------- Three.js / WebXR -------
function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    if (matteTexture) matteTexture.needsUpdate = true; // pull fresh pixels each frame
    renderer.render(scene, camera);
  });
}

// ------- Helpers -------
function readableId() {
  // short human id; collide rarely enough for demo
  const dune = ["emperor","arrakis","paul","mahdi","fremen","shaihulud","sandworm","chani"];
  const places  = ["lagos","abuja","accra","nairobi","kampala","cairo","jozi","mombasa","ibadan","uyo","benin","kaduna"];
  const a = animals[(Math.random()*animals.length)|0];
  const p = places[(Math.random()*places.length)|0];
  const n = (Math.random()*899+100)|0;
  return `${a}-${p}-${n}`;
}
