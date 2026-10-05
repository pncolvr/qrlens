export function supported(){
  return { secure: window.isSecureContext, hasMedia: !!navigator.mediaDevices?.getUserMedia };
}

export function createCamera({ video, onResult, onStatus, onError }){
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null, timer = null, generation = 0;
  let devices = [], deviceIndex = 0;

  function stop(){
    generation++;
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }

  function scan(){
    if (!stream || video.srcObject !== stream || stream.getVideoTracks()[0]?.readyState === "ended" || video.readyState < 2 || !video.videoWidth) return;
    try {
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(image.data, image.width, image.height);
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
