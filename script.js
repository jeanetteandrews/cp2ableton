'use strict';

// ── UI helpers ────────────────────────────────────────────────
function updateConnectionStatus(which, connected) {
  const el = document.getElementById(which === 1 ? 'status1' : 'status2');
  if (!el) return;
  el.textContent = connected ? 'Connected' : 'Disconnected';
  el.classList.toggle('connected', connected);
  el.classList.toggle('disconnected', !connected);
}

function markCCSending(key) {
  const btn = document.querySelector(`#cc-setup button[data-cc="${key}"]`);
  if (!btn) return;
  btn.classList.add('sending');
  clearTimeout(btn._sendingTimeout);
  btn._sendingTimeout = setTimeout(() => btn.classList.remove('sending'), 300);
}

// ── CC setup mode ─────────────────────────────────────────────
let activeCC = null;

function shouldSend(key) { return activeCC === null || activeCC === key; }

function setActiveCC(key) {
  activeCC = key;
  document.querySelectorAll('#cc-setup button').forEach(b => {
    if (b.dataset.cc !== 'all') {
      b.classList.toggle('active', b.dataset.cc === key);
    } else {
      b.classList.remove('active');
    }
  });
}

// ── CC state tracking ─────────────────────────────────────────
let lastCCX1 = null; let lastCCY1 = null; let lastCCZ1 = null;
let lastCCX2 = null; let lastCCY2 = null; let lastCCZ2 = null;

// ── MIDI outputs ──────────────────────────────────────────────
let midiOut1X = null; let midiOut1Y = null; let midiOut1Z = null;
let midiOut2X = null; let midiOut2Y = null; let midiOut2Z = null;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function toCC(val, inMin, inMax) {
  return Math.round(clamp((val - inMin) / (inMax - inMin), 0, 1) * 127);
}

function updateDisplay(key, rawVal, ccVal) {
  const el = document.getElementById('display-' + key);
  if (!el) return;
  el.querySelector('.raw-val').textContent = rawVal.toFixed(2);
  el.querySelector('.cc-val').textContent = ccVal;
}

navigator.requestMIDIAccess().then(midi => {
  for (let output of midi.outputs.values()) {
    if (output.name === "IAC Driver Bus 1") { midiOut1X = output; console.log("MIDI out 1X connected:", output.name); }
    if (output.name === "IAC Driver Bus 2") { midiOut1Y = output; console.log("MIDI out 1Y connected:", output.name); }
    if (output.name === "IAC Driver Bus 3") { midiOut1Z = output; console.log("MIDI out 1Z connected:", output.name); }
    if (output.name === "IAC Driver Bus 4") { midiOut2X = output; console.log("MIDI out 2X connected:", output.name); }
    if (output.name === "IAC Driver Bus 5") { midiOut2Y = output; console.log("MIDI out 2Y connected:", output.name); }
    if (output.name === "IAC Driver Bus 6") { midiOut2Z = output; console.log("MIDI out 2Z connected:", output.name); }
  }
  if (!midiOut1X) console.warn("IAC Driver Bus 1 not found");
  if (!midiOut1Y) console.warn("IAC Driver Bus 2 not found");
  if (!midiOut1Z) console.warn("IAC Driver Bus 3 not found");
  if (!midiOut2X) console.warn("IAC Driver Bus 4 not found");
  if (!midiOut2Y) console.warn("IAC Driver Bus 5 not found");
  if (!midiOut2Z) console.warn("IAC Driver Bus 6 not found");
});

// ── BLE ───────────────────────────────────────────────────────
const ACCEL_SERVICE = 'adaf0200-c332-42a8-93bd-25e905756cb8';
const ACCEL_CHAR    = 'adaf0201-c332-42a8-93bd-25e905756cb8';

let device1 = null;
let device2 = null;

async function connectBLE(num) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'CPlay' }],
    optionalServices: [ACCEL_SERVICE],
  });

  if (num === 1) device1 = device;
  else device2 = device;

  device.addEventListener('gattserverdisconnected', () => {
    if (num === 1) device1 = null;
    else device2 = null;
    updateConnectionStatus(num, false);
    console.log(`controller ${num} disconnected`);
  });

  const server  = await device.gatt.connect();
  const service = await server.getPrimaryService(ACCEL_SERVICE);
  const char    = await service.getCharacteristic(ACCEL_CHAR);

  await char.startNotifications();
  char.addEventListener('characteristicvaluechanged', event => {
    (num === 1 ? onDataController1 : onDataController2)(event.target.value);
  });

  updateConnectionStatus(num, true);
}

// ── controller 1 data handler ─────────────────────────────────
function onDataController1(view) {
  const x = view.getFloat32(0, true);
  const y = view.getFloat32(4, true);
  const z = view.getFloat32(8, true);

  const ccX = toCC(x, -10, 10);
  const ccY = toCC(y, -10, 10);
  const ccZ = toCC(z, -10, 10);

  updateDisplay('1X', x, ccX);
  updateDisplay('1Y', y, ccY);
  updateDisplay('1Z', z, ccZ);

  if (shouldSend('1X') && ccX !== lastCCX1) { lastCCX1 = ccX; if (midiOut1X) midiOut1X.send([0xB0, 11, ccX]); }
  if (shouldSend('1Y') && ccY !== lastCCY1) { lastCCY1 = ccY; if (midiOut1Y) midiOut1Y.send([0xB0, 12, ccY]); }
  if (shouldSend('1Z') && ccZ !== lastCCZ1) { lastCCZ1 = ccZ; if (midiOut1Z) midiOut1Z.send([0xB0, 13, ccZ]); }

  if (activeCC === null && device1) markCCSending('all');
}

// ── controller 2 data handler ─────────────────────────────────
function onDataController2(view) {
  const x2 = view.getFloat32(0, true);
  const y2 = view.getFloat32(4, true);
  const z2 = view.getFloat32(8, true);

  const ccX2 = toCC(x2, -10, 10);
  const ccY2 = toCC(y2, -10, 10);
  const ccZ2 = toCC(z2, -10, 10);

  updateDisplay('2X', x2, ccX2);
  updateDisplay('2Y', y2, ccY2);
  updateDisplay('2Z', z2, ccZ2);

  if (shouldSend('2X') && ccX2 !== lastCCX2) { lastCCX2 = ccX2; if (midiOut2X) midiOut2X.send([0xB0, 21, ccX2]); }
  if (shouldSend('2Y') && ccY2 !== lastCCY2) { lastCCY2 = ccY2; if (midiOut2Y) midiOut2Y.send([0xB0, 22, ccY2]); }
  if (shouldSend('2Z') && ccZ2 !== lastCCZ2) { lastCCZ2 = ccZ2; if (midiOut2Z) midiOut2Z.send([0xB0, 23, ccZ2]); }

  if (activeCC === null && device2) markCCSending('all');
}

// ── connect buttons ───────────────────────────────────────────
function checkAllConnected() {
  const count = [device1, device2].filter(Boolean).length;
  console.log(`${count}/2 controllers connected`);
}

document.getElementById('ble1').addEventListener('click', async () => {
  try {
    await connectBLE(1);
  } catch (e) {
    console.error('BLE 1 error:', e);
    device1 = null;
    updateConnectionStatus(1, false);
  }
  checkAllConnected();
});

document.getElementById('ble2').addEventListener('click', async () => {
  try {
    await connectBLE(2);
  } catch (e) {
    console.error('BLE 2 error:', e);
    device2 = null;
    updateConnectionStatus(2, false);
  }
  checkAllConnected();
});

// ── CC setup panel ────────────────────────────────────────────
document.querySelectorAll('#cc-setup button').forEach(b => {
  b.addEventListener('click', () => {
    const cc = b.dataset.cc;
    if (cc === 'all') {
      if (!device1 && !device2) { alert('Connect at least one controller first'); return; }
    } else if (cc.startsWith('1')) {
      if (!device1) { alert('Connect controller 1 first'); return; }
    } else if (cc.startsWith('2')) {
      if (!device2) { alert('Connect controller 2 first'); return; }
    }
    setActiveCC(cc === 'all' ? null : cc);
  });
});
setActiveCC(null);
