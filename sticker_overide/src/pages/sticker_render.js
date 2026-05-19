const STORAGE_KEY = 'lastJasperStickerCapture';
let currentCapture = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function short(value, fallback = '-') {
  const text = String(value || '').trim();
  return text || fallback;
}

function createQr(container, text) {
  container.innerHTML = '';
  new QRCode(container, {
    text: text || 'no-data',
    width: 74,
    height: 74,
    correctLevel: QRCode.CorrectLevel.M
  });
}

function createSticker(item) {
  const el = document.createElement('section');
  el.className = 'sticker';
  el.innerHTML = `
    <div class="sticker-header">
      <div class="sticker-title">IP Drug Sticker Thai</div>
      <div class="sticker-index">#${esc(item.index)}</div>
    </div>
    <div class="content">
      <div class="line"><span class="label">HN:</span> ${esc(short(item.hn))} &nbsp; <span class="label">AN:</span> ${esc(short(item.an))}</div>
      <div class="line"><span class="label">Patient:</span> ${esc(short(item.patientName))}</div>
      <div class="line"><span class="label">Ward/Bed:</span> ${esc(short(item.ward))} / ${esc(short(item.bed))}</div>
      <div class="drug">${esc(short(item.drugName, 'Drug name not detected'))}</div>
      <div class="line"><span class="label">Dose:</span> ${esc(short(item.dose))}</div>
      <div class="line"><span class="label">Route:</span> ${esc(short(item.route))} &nbsp; <span class="label">Freq:</span> ${esc(short(item.frequency))}</div>
      <div class="line"><span class="label">Qty:</span> ${esc(short(item.qty))}</div>
      <div class="extra">${esc(item.extraText || '')}</div>
    </div>
    <div class="qr-box">
      <div class="qr"></div>
      <div class="qr-label">Scan for verify data</div>
    </div>
    <div class="raw-lines">${esc((item.rawLines || []).join(' | '))}</div>
  `;
  createQr(el.querySelector('.qr'), item.qrText);
  return el;
}

function render(capture) {
  const app = document.getElementById('app');
  const info = document.getElementById('captureInfo');
  app.innerHTML = '';

  if (!capture) {
    info.textContent = 'No capture found';
    app.innerHTML = `
      <div class="empty">
        <h2>No captured data yet</h2>
        <p>Open a Jasper ipdsticker report page, then click <strong>Capture + Rebuild Sticker</strong>.</p>
        <p>This prototype stores data locally in chrome.storage.local only.</p>
      </div>
    `;
    return;
  }

  const stickers = capture.stickers || [];
  info.textContent = `${stickers.length} sticker(s) · ${capture.responseInfo?.sheetNames?.join(', ') || 'no sheet'} · ${capture.requestPayload?.capturedAt || ''}`;

  if (!stickers.length) {
    app.innerHTML = `<div class="empty"><h2>Capture found but no sticker data was detected</h2><p>Open raw rows to inspect the Excel layout.</p></div>`;
    return;
  }

  stickers.forEach((item) => app.appendChild(createSticker(item)));
}

function exportJson() {
  if (!currentCapture) return alert('No capture to export.');
  const blob = new Blob([JSON.stringify(currentCapture, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jasper-sticker-capture-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function showRaw() {
  const dlg = document.getElementById('rawDialog');
  const out = document.getElementById('rawOutput');
  out.textContent = JSON.stringify(currentCapture, null, 2);
  dlg.showModal();
}

chrome.storage.local.get([STORAGE_KEY], (data) => {
  currentCapture = data[STORAGE_KEY] || null;
  render(currentCapture);
});

document.getElementById('btnPrint').addEventListener('click', () => window.print());
document.getElementById('btnExportJson').addEventListener('click', exportJson);
document.getElementById('btnShowRaw').addEventListener('click', showRaw);
document.getElementById('btnCloseRaw').addEventListener('click', () => document.getElementById('rawDialog').close());

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && e.ctrlKey) {
    e.preventDefault();
    document.body.classList.toggle('show-raw-lines');
  }
});
