"use strict";
document.addEventListener('DOMContentLoaded', () => {
  if (window.HMHosted) return;
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Open server pilot';
  button.addEventListener('click', async () => {
    if (!_context?.patientvisituid) return;
    const child = window.open('about:blank', '_blank');
    if (!child) return;
    const base = await BKNData.getServerUrl();
    const url = new URL('/hm-pilot/src/features/home-med/' + (_IS_OPD_SHEET ? 'OPD-Sheet.html' : 'page-home-med.html'), base);
    const context = structuredClone(_context);
    const listener = event => {
      if (event.source !== child || event.origin !== url.origin || event.data?.type !== 'HM_PILOT_READY') return;
      child.postMessage({type:'HM_PILOT_CONTEXT', context}, url.origin);
      window.removeEventListener('message', listener);
    };
    window.addEventListener('message', listener);
    child.location.href = url.href;
    setTimeout(() => window.removeEventListener('message', listener), 120000);
  });
  document.querySelector('.toolbar')?.prepend(button);
});
