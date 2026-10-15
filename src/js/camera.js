export function supported(){
  return { secure: window.isSecureContext, hasMedia: !!navigator.mediaDevices?.getUserMedia };
}

export function createCamera({ video, scanRegion, onResult, onStatus, onError }){
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null, timer = null, generation = 0;
  let devices = [], deviceIndex = 0;
  let scanCount = 0;

  function stop(){
    generation++;
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    if (scanRegion) scanRegion.classList.add("hidden");
  }

  function decode(x, y, width, height, maxSize){
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const targetWidth = Math.round(width * scale), targetHeight = Math.round(height * scale);
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    context.drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(image.data, image.width, image.height);
  }

  function scan(){
    if (!stream || video.srcObject !== stream || stream.getVideoTracks()[0]?.readyState === "ended" || video.readyState < 2 || !video.videoWidth) return;
    try {
      const size = Math.round(Math.min(video.videoWidth, video.videoHeight) * 2 / 3);
      const x = Math.round((video.videoWidth - size) / 2), y = Math.round((video.videoHeight - size) / 2);
      if (scanRegion){
        // The preview uses object-fit: contain. Include its letterboxing offsets.
        const displayScale = Math.min(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight);
        Object.assign(scanRegion.style, {
          left: `${(video.clientWidth - video.videoWidth * displayScale) / 2 + x * displayScale}px`,
          top: `${(video.clientHeight - video.videoHeight * displayScale) / 2 + y * displayScale}px`,
          width: `${size * displayScale}px`, height: `${size * displayScale}px`
        });
        scanRegion.classList.remove("hidden");
      }
      let code = decode(x, y, size, size, 640);
      // Keep finding codes outside the guide without decoding the full frame every time.
      if (!code && ++scanCount % 5 === 0) code = decode(0, 0, video.videoWidth, video.videoHeight, 1280);
      if (code && typeof code.data === "string"){
        stop();
        onResult(code.data);
      }
    } catch(error){
      stop();
      onError(error);
    }
  }

  async function start(deviceId){
    stop();
    const request = generation;
    if (typeof window.jsQR !== "function" || !context) throw new Error("QR decoder unavailable.");
    const opened = await navigator.mediaDevices.getUserMedia({
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }), width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    if (request !== generation){ opened.getTracks().forEach(track => track.stop()); return false; }
    stream = opened;
    video.srcObject = stream;
    try {
      await video.play();
      try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { }
      try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput"); } catch { devices = []; }
      if (request !== generation) return false;
      const activeId = stream.getVideoTracks()[0].getSettings().deviceId;
      deviceIndex = Math.max(0, devices.findIndex(device => device.deviceId === activeId));
      onStatus({ deviceCount: devices.length });
      scanCount = 0;
      timer = setInterval(scan, 220);
      return true;
    } catch(error){
      if (request !== generation) return false;
      stop();
      throw error;
    }
  }

  function switchDevice(){
    if (devices.length < 2) return Promise.resolve(false);
    return start(devices[(deviceIndex + 1) % devices.length].deviceId);
  }

  return { start, stop, switchDevice };
}
