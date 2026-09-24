chrome.action.onClicked.addListener(async tab => {
if (!tab.id || !tab.url?.startsWith('https://arcusair.bdms.co.th/')) return;
try { await chrome.scripting.executeScript({target:{tabId:tab.id},files:['overlay.js']}); }
catch (error) { console.warn('Paperless test overlay could not be injected:', error.message); }
});
