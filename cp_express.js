// ── shared state ──────────────────────────────────────────────
let buf1 = "";
let buf2 = "";

// UI helpers
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
// null = all CCs send; otherwise only the selected key sends
let activeCC = null;

function shouldSend(key) { return activeCC === null || activeCC === key; }

function setActiveCC(key) {
  activeCC = key;
  document.querySelectorAll('#cc-setup button').forEach(b => {
    // Only apply active class to individual CC buttons, not the "all" button
    if (b.dataset.cc !== 'all') {
      b.classList.toggle('active', b.dataset.cc === key);
    } else {
      b.classList.remove('active');
    }
  });
}

const BEAT = 115;

// ── CC state tracking ─────────────────────────────────────────
let lastCCX1 = null; let lastCCY1 = null; let lastCCZ1 = null; let lastCC14 = null;
let lastCCX2 = null; let lastCCY2 = null; let lastCCZ2 = null; let lastCCZ2val = null;

// ── instruments ───────────────────────────────────────────────
let writer1 = null;  // inst 1 notes
let writer2 = null;  // inst 2 notes
let midiOut1X = null; let midiOut1Y = null; let midiOut1Z = null; let midiOut1Zpos = null;
let midiOut2X = null; let midiOut2Y = null; let midiOut2Z = null; let midiOut2Zval = null;

let z  = 0;
let z2 = 0;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function toCC(val, inMin, inMax) {
  return Math.round(clamp((val - inMin) / (inMax - inMin), 0, 1) * 127);
}

// ── MIDI setup ────────────────────────────────────────────────
navigator.requestMIDIAccess().then(midi => {
  for (let output of midi.outputs.values()) {
    if (output.name === "IAC Driver Bus 1") { midiOut1X = output; console.log("MIDI out 1X connected:", output.name); }
    if (output.name === "IAC Driver Bus 2") { midiOut1Y = output; console.log("MIDI out 1Y connected:", output.name); }
    if (output.name === "IAC Driver Bus 3") { midiOut1Z = output; console.log("MIDI out 1Z connected:", output.name); }
    if (output.name === "IAC Driver Bus 4") { midiOut2X = output; console.log("MIDI out 2X connected:", output.name); }
    if (output.name === "IAC Driver Bus 5") { midiOut2Y = output; console.log("MIDI out 2Y connected:", output.name); }
    if (output.name === "IAC Driver Bus 6") { midiOut2Z = output; console.log("MIDI out 2Z connected:", output.name); }
    if (output.name === "IAC Driver Bus 7") { midiOut2Zval = output; console.log("MIDI out 2Zval connected:", output.name); }
    if (output.name === "IAC Driver Bus 8") { midiOut1Zpos = output; console.log("MIDI out 1Zpos connected:", output.name); }
  }
  if (!midiOut1X) console.warn("IAC Driver Bus 1 not found");
  if (!midiOut1Y) console.warn("IAC Driver Bus 2 not found");
  if (!midiOut1Z) console.warn("IAC Driver Bus 3 not found");
  if (!midiOut2X) console.warn("IAC Driver Bus 4 not found");
  if (!midiOut2Y) console.warn("IAC Driver Bus 5 not found");
  if (!midiOut2Z) console.warn("IAC Driver Bus 6 not found");
  if (!midiOut2Zval) console.warn("IAC Driver Bus 7 not found");
  if (!midiOut1Zpos) console.warn("IAC Driver Bus 8 not found");
});

// ── serial ────────────────────────────────────────────────────
async function connectSerial(onDataCallback) {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });

  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  decoder.readable.pipeTo(new WritableStream({
    write(chunk) { onDataCallback(chunk); }
  }));

  const encoder = new TextEncoderStream();
  encoder.readable.pipeTo(port.writable);
  const writer = encoder.writable.getWriter();
  // attach the port to the writer so disconnect events can be correlated
  writer._port = port;

  return writer;
}

async function serialSend(writer, msg) {
  if (writer) {
    await writer.write(msg + "\n");
  }
}

function checkAllConnected() {
  if (writer1 && writer2) {
    console.log("all instruments connected");
  } else {
    const count = [writer1, writer2].filter(Boolean).length;
    console.log(`${count}/2 instruments connected`);
  }
}

document.getElementById('serial1').addEventListener('click', async () => {
  try {
    writer1 = await connectSerial(onDataInstrument1);
    updateConnectionStatus(1, !!writer1);
  } catch (e) {
    console.error('serial1 connect error:', e);
    writer1 = null;
    updateConnectionStatus(1, false);
  }
  checkAllConnected();
});
document.getElementById('serial2').addEventListener('click', async () => {
  try {
    writer2 = await connectSerial(onDataInstrument2);
    updateConnectionStatus(2, !!writer2);
  } catch (e) {
    console.error('serial2 connect error:', e);
    writer2 = null;
    updateConnectionStatus(2, false);
  }
  checkAllConnected();
});

// ── instrument 1 data handler ─────────────────────────────────
function onDataInstrument1(chunk) {
  buf1 += chunk;
  let lines = buf1.split("\n");
  buf1 = lines.pop();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length === 5 && !line.includes("[")) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      z = parseFloat(parts[2]);

      const ccX = toCC(x, -10, 10);
      const ccY = toCC(y, -10, 10);
      const ccZ = Math.abs(z - (-9.8)) <= 0.5 ? 127 : 0;
      if (shouldSend('1X') && ccX !== lastCCX1) { lastCCX1 = ccX; if (midiOut1X) midiOut1X.send([0xB0, 11, ccX]); }
      if (shouldSend('1Y') && ccY !== lastCCY1) { lastCCY1 = ccY; if (midiOut1Y) midiOut1Y.send([0xB0, 12, ccY]); }
      if (shouldSend('1Z') && ccZ !== lastCCZ1) { lastCCZ1 = ccZ; if (midiOut1Z) midiOut1Z.send([0xB0, 13, ccZ]); }
      const cc14 = (z >= 0 && z <= 9.8) ? 127 : 0;
      if (shouldSend('1Zpos') && cc14 !== lastCC14) { lastCC14 = cc14; if (midiOut1Zpos) midiOut1Zpos.send([0xB0, 14, cc14]); }
      // UI highlight for "Play all CCs" button only
      if (activeCC === null && writer1) markCCSending('all');
    }
  }
}

// ── instrument 2 data handler ─────────────────────────────────
function onDataInstrument2(chunk) {
  buf2 += chunk;
  let lines = buf2.split("\n");
  buf2 = lines.pop();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length === 5 && !line.includes("[")) {
      const x2 = parseFloat(parts[0]);
      const y2 = parseFloat(parts[1]);
      z2 = parseFloat(parts[2]);

      const ccX2 = toCC(x2, -10, 10);
      const ccY2 = toCC(y2, -10, 10);
      const ccZ2 = Math.abs(z2 - (-9.8)) <= 0.5 ? 127 : 0;
      const ccZ2val = z2 >= 0 ? 127 : toCC(z2, -9.8, 0);
      if (shouldSend('2X') && ccX2 !== lastCCX2) { lastCCX2 = ccX2; if (midiOut2X) midiOut2X.send([0xB0, 21, ccX2]); }
      if (shouldSend('2Y') && ccY2 !== lastCCY2) { lastCCY2 = ccY2; if (midiOut2Y) midiOut2Y.send([0xB0, 22, ccY2]); }
      if (shouldSend('2Z') && ccZ2 !== lastCCZ2) { lastCCZ2 = ccZ2; if (midiOut2Z) midiOut2Z.send([0xB0, 23, ccZ2]); }
      if (shouldSend('2Zval') && ccZ2val !== lastCCZ2val) { lastCCZ2val = ccZ2val; if (midiOut2Zval) midiOut2Zval.send([0xB0, 24, ccZ2val]); }
      // UI highlight for "Play all CCs" button only
      if (activeCC === null && writer2) markCCSending('all');
    }
  }
}


navigator.serial.addEventListener('connect', async (e) => {
  const port = e.target;
  console.log("device plugged in — press button A to identify");

  await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1 second

  try {
    await port.open({ baudRate: 9600 });
  } catch(e) {
    console.log("port open error:", e);
    return;
  }

  const encoder = new TextEncoderStream();
  encoder.readable.pipeTo(port.writable);
  const portWriter = encoder.writable.getWriter();
      // attach the port to the writer for disconnect identification
      portWriter._port = port;

  let buf = "";
  let identified = false;
  let assignedHandler = null;

  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  decoder.readable.pipeTo(new WritableStream({
    write(chunk) {
      buf += chunk;
      let lines = buf.split("\n");
      buf = lines.pop();

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith("DEVICE:")) {
          const name = line.replace("DEVICE:", "").trim();
          console.log(`identified: ${name}`);
          identified = true;

          if (name === "inst1") { writer1 = portWriter; assignedHandler = onDataInstrument1; console.log("inst1 reconnected"); updateConnectionStatus(1, true); }
          else if (name === "inst2") { writer2 = portWriter; assignedHandler = onDataInstrument2; console.log("inst2 reconnected"); updateConnectionStatus(2, true); }
          continue;
        }

        if (identified && assignedHandler) {
          assignedHandler(line + "\n");
        }
      }
    }
  }));
});

navigator.serial.addEventListener('disconnect', (e) => {
  console.log("device disconnected — plug it back in and press button A");
  if (writer1 && writer1._port === e.target) { writer1 = null; console.log('controller 1 disconnected'); }
  if (writer2 && writer2._port === e.target) { writer2 = null; console.log('controller 2 disconnected'); }
  updateConnectionStatus(1, !!writer1);
  updateConnectionStatus(2, !!writer2);
});

// ── CC setup panel ────────────────────────────────────────────
document.querySelectorAll('#cc-setup button').forEach(b => {
  b.addEventListener('click', () => {
    const cc = b.dataset.cc;
    // Check connection status before allowing click
    if (cc === 'all') {
      if (!writer1 && !writer2) {
        alert('Connect at least one controller first');
        return;
      }
    } else if (cc.startsWith('1')) {
      if (!writer1) {
        alert('Connect controller 1 first');
        return;
      }
    } else if (cc.startsWith('2')) {
      if (!writer2) {
        alert('Connect controller 2 first');
        return;
      }
    }
    setActiveCC(cc === 'all' ? null : cc);
  });
});
setActiveCC(null);