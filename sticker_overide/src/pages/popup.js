const statusEl = document.getElementById('status');
const openBtn = document.getElementById('openRenderer');

chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS' }, (res) => {
  const s = res?.summary;
  if (!s) {
    statusEl.textContent = 'No captured Jasper sticker data yet.';
    return;
  }
  statusEl.textContent = `Last capture: ${s.stickerCount} sticker(s), ${s.sheetNames.join(', ')}`;
});

openBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_STICKER_RENDERER' });
});
