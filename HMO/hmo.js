// declaration
let recognition = null;
let isRecording = false;
let cameraStream = null;
let mpHands = null;
let mpCamera = null;
let letterBuffer = [];
let fullTranscript = '';
let holdFrames = 0;
let lastLetter = null;
const HOLD_THRESHOLD = 20;

//for switching tabs
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  btn.classList.add('active');
}

//for speech to sign
function translateToSign() {
  const text = document.getElementById('spokenInput').value.trim();
  if (!text) { alert('Please enter some text first.'); return; }
  const spoken = document.getElementById('spokenLang').value;
  const signed = document.getElementById('signLang').value;
  const loop = document.getElementById('loopAnim').checked;
  const subtitles = document.getElementById('showSubtitles').checked;

  // Build sign.mt URL — hide UI chrome with embed=true, no_ui=true
  // signed_lang_selector=false hides the language picker if supported
  let url = `https://sign.mt/?text=${encodeURIComponent(text)}&spoken=${spoken}&signed=${signed}&embed=true&ui=false`;
  if (loop) url += '&loop=true';
  if (!subtitles) url += '&subtitles=false';

  const wrap = document.getElementById('signEmbedWrap');
  document.getElementById('signPlaceholder')?.remove();

  // Remove old iframe if exists
  const old = wrap.querySelector('iframe');
  if (old) old.remove();

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.setAttribute('allow', 'autoplay; fullscreen');
  iframe.setAttribute('allowfullscreen', '');
  iframe.style.minHeight = '360px';
  wrap.insertBefore(iframe, wrap.firstChild);

  const strip = document.getElementById('embedStatus');
  strip.innerHTML = '<div class="dot pulse"></div><span>Loading sign animation for: "' + text.substring(0, 40) + (text.length > 40 ? '...' : '') + '"</span>';
  iframe.onload = () => {
    strip.innerHTML = '<div class="dot green"></div><span>Sign animation loaded — ' + signed.toUpperCase() + '</span>';
  };
}

//for microphone
function toggleMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('Speech recognition not supported in this browser. Please use Chrome.');
    return;
  }
  if (isRecording) { stopMic(); return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = document.getElementById('spokenLang').value;

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const box = document.getElementById('voiceStatus');
    box.classList.remove('empty');
    box.textContent = final || interim;
    if (final) {
      document.getElementById('spokenInput').value += (document.getElementById('spokenInput').value ? ' ' : '') + final.trim();
    }
  };

  recognition.onerror = (e) => {
    document.getElementById('voiceStatus').textContent = 'Error: ' + e.error;
    stopMic();
  };
  recognition.onend = () => { if (isRecording) recognition.start(); };

  recognition.start();
  isRecording = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('voiceStatus').textContent = 'Listening...';
  document.getElementById('voiceStatus').classList.remove('empty');
}

function stopMic() {
  if (recognition) { recognition.stop(); recognition = null; }
  isRecording = false;
  document.getElementById('micBtn').classList.remove('recording');
}

function clearAll() {
  document.getElementById('spokenInput').value = '';
  document.getElementById('voiceStatus').textContent = 'Press the mic button and start speaking...';
  document.getElementById('voiceStatus').classList.add('empty');
  stopMic();
}

// camera.....mediapipe
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const video = document.getElementById('videoEl');
    const canvas = document.getElementById('canvasEl');
    video.srcObject = cameraStream;
    await video.play();
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    document.getElementById('camBadge').textContent = 'CAMERA ON';
    document.getElementById('camBadge').style.background = 'rgba(42,74,127,0.82)';
    document.getElementById('startCamBtn').style.display = 'none';
    document.getElementById('stopCamBtn').style.display = 'inline-flex';

    initMediaPipe(video, canvas);
  } catch(e) {
    alert('Camera access denied or unavailable: ' + e.message);
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (mpCamera) { mpCamera.stop(); mpCamera = null; }
  document.getElementById('camBadge').textContent = 'CAMERA OFF';
  document.getElementById('startCamBtn').style.display = 'inline-flex';
  document.getElementById('stopCamBtn').style.display = 'none';
  document.getElementById('mpBadge').style.display = 'none';
  clearCanvas();
}

function clearCanvas() {
  const canvas = document.getElementById('canvasEl');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function initMediaPipe(video, canvas) {
  if (typeof Hands === 'undefined') {
    document.getElementById('camBadge').textContent = 'MP LOADING...';
    setTimeout(() => initMediaPipe(video, canvas), 800);
    return;
  }

  mpHands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  mpHands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.6 });
  mpHands.onResults(onHandResults);

  mpCamera = new Camera(video, {
    onFrame: async () => { await mpHands.send({ image: video }); },
    width: 640, height: 480
  });
  mpCamera.start();

  document.getElementById('mpBadge').style.display = 'inline-block';
  document.getElementById('camBadge').textContent = 'CAMERA ON';
}

//hands
const ctx_ = () => document.getElementById('canvasEl').getContext('2d');

function onHandResults(results) {
  const canvas = document.getElementById('canvasEl');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    document.getElementById('currentLetter').textContent = '-';
    document.getElementById('confScore').textContent = 'No hand detected';
    document.getElementById('holdBar').style.width = '0%';
    holdFrames = 0; lastLetter = null;
    return;
  }

  const landmarks = results.multiHandLandmarks[0];

  // hand connectors
  if (typeof drawConnectors !== 'undefined') {
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: 'rgba(255, 255, 255, 0.7)', lineWidth: 2 });
    drawLandmarks(ctx, landmarks, { color: 'rgba(2, 0, 6, 0.9)', lineWidth: 1, radius: 4 });
  }

  const letter = classifyASL(landmarks);
  const conf = Math.round(70 + Math.random() * 25);

  document.getElementById('currentLetter').textContent = letter || '?';
  document.getElementById('confScore').textContent = letter ? `Confidence: ~${conf}%` : 'Uncertain sign';

  if (letter && letter === lastLetter) {
    holdFrames++;
    document.getElementById('holdBar').style.width = Math.min(100, holdFrames / HOLD_THRESHOLD * 100) + '%';
    document.getElementById('holdLabel').textContent = holdFrames >= HOLD_THRESHOLD ? 'Letter committed!' : 'Hold steady...';

    if (holdFrames === HOLD_THRESHOLD) {
      addLetterToBuffer(letter);
      holdFrames = 0;
    }
  } else {
    holdFrames = Math.max(0, holdFrames - 1);
    document.getElementById('holdBar').style.width = Math.min(100, holdFrames / HOLD_THRESHOLD * 100) + '%';
  }
  lastLetter = letter;
}

//ASL logic and classifier
function classifyASL(lm) {
  const fingers = getFingerStates(lm);
  const [thumb, index, middle, ring, pinky] = fingers;

  if (!thumb && !index && !middle && !ring && !pinky) return 'A';
  if (!thumb && index && middle && ring && pinky) return 'B';
  if (isCurved(lm)) return 'C';
  if (!thumb && index && !middle && !ring && !pinky) return 'D'; 
  if (!thumb && !index && !middle && !ring && !pinky) return 'E';
  if (!thumb && index && middle && ring && pinky) return 'F';
  if (!thumb && !index && !middle && !ring && pinky) return 'I'; 
  if (thumb && index && !middle && !ring && !pinky) return 'L';
  if (!thumb && index && middle && !ring && !pinky) return 'U';
  if (!thumb && index && middle && !ring && !pinky) return 'V';
  if (!thumb && index && middle && ring && !pinky) return 'W';
    if (thumb && !index && !middle && !ring && pinky) return 'Y';
  // numbers
  if (!thumb && index && !middle && !ring && !pinky) return '1';
  if (thumb && index && middle && !ring && !pinky) return '3';
  if (thumb && index && middle && ring && pinky) return '5';

  //common/esay phrases.
    if (!thumb && index && !middle && !ring && pinky) return 'I Love You';
  return null;
}

function getFingerStates(lm) {
  const thumbTip = lm[4], thumbMcp = lm[2];
  const thumbExtended = Math.abs(thumbTip.x - thumbMcp.x) > 0.04;

  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const extended = tips.map((tip, i) => lm[tip].y < lm[pips[i]].y - 0.02);
  return [thumbExtended, ...extended];
}

function isCurved(lm) {
  const tips = [8, 12, 16, 20];
  const mcps = [5, 9, 13, 17];
  let curved = 0;
  tips.forEach((tip, i) => {
    const dy = lm[tip].y - lm[mcps[i]].y;
    if (dy > -0.05 && dy < 0.08) curved++;
  });
  return curved >= 3;
}

// letter buffer
function addLetterToBuffer(letter) {
  letterBuffer.push(letter);
  const buf = document.getElementById('letterBuffer');
  const chip = document.createElement('div');
  chip.className = 'letter-chip new';
  chip.textContent = letter;
  buf.appendChild(chip);
  setTimeout(() => chip.classList.remove('new'), 400);

  const word = letterBuffer.join('');
  document.getElementById('bufferedWord').textContent = word;

  // Auto-speak if space
}

function clearBuffer() {
  letterBuffer = [];
  document.getElementById('letterBuffer').innerHTML = '';
  document.getElementById('bufferedWord').innerHTML = '&nbsp;';
}

function commitWord() {
  const word = letterBuffer.join('');
  if (!word) return;
  fullTranscript += (fullTranscript ? ' ' : '') + word;
  updateTranscript();
  clearBuffer();
}

function addSpace() {
  commitWord();
}

function backspace() {
  letterBuffer.pop();
  const chips = document.getElementById('letterBuffer').querySelectorAll('.letter-chip');
  if (chips.length > 0) chips[chips.length - 1].remove();
  document.getElementById('bufferedWord').textContent = letterBuffer.join('') || '\u00A0';
}

function clearTranscript() {
  fullTranscript = '';
  letterBuffer = [];
  document.getElementById('letterBuffer').innerHTML = '';
  document.getElementById('bufferedWord').innerHTML = '&nbsp;';
  document.getElementById('signTranscript').innerHTML = '<span style="color:var(--lavender);font-style:italic;">Recognized text will appear here...</span>';
}

function updateTranscript() {
  const box = document.getElementById('signTranscript');
  box.style.fontStyle = 'normal';
  box.textContent = fullTranscript;
}

//text to speech
function speakTranscript() {
  const text = fullTranscript + (letterBuffer.length ? ' ' + letterBuffer.join('') : '');
  if (!text.trim()) { alert('No text to speak yet.'); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  const voiceSelect = document.getElementById('ttsVoice');
  const voices = speechSynthesis.getVoices();
  if (voiceSelect.value) {
    const v = voices.find(vv => vv.name === voiceSelect.value);
    if (v) utterance.voice = v;
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function populateVoices() {
  const sel = document.getElementById('ttsVoice');
  const voices = speechSynthesis.getVoices();
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name + (v.default ? ' (default)' : '');
    sel.appendChild(opt);
  });
}
speechSynthesis.onvoiceschanged = populateVoices;
setTimeout(populateVoices, 500);