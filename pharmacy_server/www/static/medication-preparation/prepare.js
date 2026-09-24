"use strict";
(() => {
  const $ = id => document.getElementById(id), API = '/api/medication-preparations';
  const PENDING = 'pharmacy.preparation.pending';
  const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0,10);
  const formatter = new Intl.DateTimeFormat('en-GB', {dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Bangkok'});
  const formatTime = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : formatter.format(d); };
  let pending = null, busy = false, connected = false, staffReady = false, scanTimer, offset = 0, total = 0, historyVersion = 0;
  function feedback(message, kind = '') { $('feedback').textContent = message; $('feedback').className = 'feedback ' + kind; }
  function focusScanner() {
    if (!$('staff').value || $('order').disabled || $('order').readOnly || document.hidden) return;
    $('order').focus({preventScroll:true});
  }
  function focusAfterSelection() {
    focusScanner();
    // Native select menus can restore focus as they close; focus again next frame.
    requestAnimationFrame(focusScanner);
  }
  function controls() {
    const wasDisabled = $('order').disabled;
    $('staff').disabled = !staffReady || busy || !!pending;
    $('order').disabled = !connected || !staffReady || !$('staff').value || busy;
    $('order').readOnly = !!pending;
    $('save').disabled = !connected || !staffReady || !$('staff').value || busy;
    $('save').textContent = busy ? 'Saving…' : pending ? 'Retry save' : 'Save preparation';
    $('connect').disabled = busy;
    if (wasDisabled && !$('order').disabled) focusAfterSelection();
  }
  function remember() { try { if (pending) sessionStorage.setItem(PENDING,JSON.stringify(pending)); else sessionStorage.removeItem(PENDING); } catch (_) {} }
  async function request(url, options = {}) {
    let response;
    try { response = await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000),...options}); }
    catch (_) { throw Error('Cannot confirm server save. Check the connection and retry the same order.'); }
    let data; try { data = await response.json(); } catch (_) { throw Error('Unexpected server response. Retry the same order.'); }
    if (!response.ok) { const error = Error(data.error || `Server returned HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  }
  async function history() {
    const version = ++historyVersion;
    const query = new URLSearchParams({from:$('from').value,to:$('to').value,orderNumber:$('search').value.trim(),limit:'100',offset:String(offset)});
    $('history-status').textContent = 'Loading…';
    try {
      const data = await request(API + '?' + query);
      if (version !== historyVersion) return;
      if (!Array.isArray(data.rows)) throw Error('Unexpected preparation history response');
      connected = true; total = data.total;
      const fragment = document.createDocumentFragment();
      for (const row of data.rows) {
        const tr = document.createElement('tr');
        for (const value of [formatTime(row.preparedAt),row.orderNumber,row.staffName]) {const td = document.createElement('td');td.textContent = value;tr.append(td);}
        fragment.append(tr);
      }
      if (!data.rows.length) {const tr = document.createElement('tr'),td = document.createElement('td');td.colSpan = 3;td.textContent = 'No preparations in this selection.';tr.append(td);fragment.append(tr);}
      $('rows').replaceChildren(fragment);$('history-status').textContent = '';
      $('count').textContent = `${total} records · ${total ? offset + 1 : 0}–${Math.min(offset + data.rows.length,total)}`;
      $('previous').disabled = offset === 0;$('next').disabled = offset + 100 >= total;
    } catch (error) {
      if (version !== historyVersion) return;
      $('history-status').textContent = error.status === 404 ? 'Preparation API is not active yet. The pharmacy server needs to restart after this update.' : error.message;
      if (error.status === 404) connected = false;
    } finally { if (version === historyVersion) controls(); }
  }
  async function connect() {
    $('connect').disabled = true;
    try {
      const list = await request('/api/iv-staff');
      if (!Array.isArray(list)) throw Error('IV sticker staff list is unavailable');
      const names = [...new Set(list.filter(s => s && typeof s.name === 'string' && s.name.trim()).map(s => s.name))];
      if (!names.length) throw Error('No staff names in the IV sticker list. Ask an administrator to update it.');
      const selected = pending?.staffName || $('staff').value;
      $('staff').replaceChildren(new Option('— Select your name / เลือกชื่อ —',''),...names.map(name => new Option(name,name)));
      if (pending && !names.includes(selected)) $('staff').append(new Option(selected + ' (previous selection)',selected));
      $('staff').value = selected;staffReady = true;
      await history();
      if (pending) { $('order').value = pending.orderNumber;feedback('An earlier scan has no confirmed response. Retry save to check or save it without duplicating the log.','error'); }
      else feedback(connected ? 'Select your name, then scan a prepared order.' : 'Waiting for the preparation API. Reload connection after the server restarts.', connected ? '' : 'error');
    } catch (error) {staffReady = false;feedback(error.message,'error');}
    finally {controls();focusAfterSelection();}
  }
  async function save() {
    clearTimeout(scanTimer);
    if (busy || !connected || !staffReady) return;
    if (!pending) {
      const name = $('staff').value, order = $('order').value.trim();
      if (!name) {feedback('Select your name first.','error');$('staff').focus();return;}
      if (!/^[IOE][A-Za-z0-9._/-]{1,159}$/.test(order)) {feedback('Scan an order number beginning with I, O, or E.','error');$('order').focus();return;}
      pending = {staffName:name,orderNumber:order,scanDate:today()};remember();
    }
    busy = true;controls();feedback('Saving ' + pending.orderNumber + '…');
    try {
      const data = await request(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
      if (!data.ok || !data.record || data.record.orderNumber !== pending.orderNumber || data.record.staffName !== pending.staffName) throw Error('Server confirmation did not match this scan. Retry the same order.');
      feedback((data.duplicate ? 'Already recorded' : 'Saved') + ' · ' + data.record.orderNumber + ' · ' + data.record.staffName,'success');
      $('last-save').textContent = 'Server record: ' + formatTime(data.record.preparedAt) + ' (Bangkok)';
      pending = null;remember();$('order').value = '';
      // Refresh the log without holding up the next scan.
      history();
    } catch (error) {
      feedback(error.message + (error.status === 400 ? '' : ' Nothing is marked saved until the server confirms.'),'error');
      // A validation rejection is definitive: let staff correct the selection/input.
      if (error.status === 400) {pending = null;remember();}
    } finally {busy = false;controls();focusAfterSelection();}
  }
  try {const saved = JSON.parse(sessionStorage.getItem(PENDING) || 'null');if (saved && typeof saved.staffName === 'string' && typeof saved.orderNumber === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.scanDate)) pending = saved;} catch (_) {}
  $('from').value = today();$('to').value = today();
  $('staff').addEventListener('change',()=>{clearTimeout(scanTimer);$('order').value = '';controls();feedback($('staff').value ? 'Ready · ' + $('staff').value + ' · scan a prepared order.' : 'Select your name first.');focusAfterSelection();});
  $('scan-form').addEventListener('submit',event=>{event.preventDefault();save();});
  $('order').addEventListener('keydown',event=>{if (event.key === 'Tab' && $('order').value.trim()) {event.preventDefault();save();}});
  $('order').addEventListener('input',()=>{clearTimeout(scanTimer);if (!pending && $('order').value.trim()) scanTimer = setTimeout(save,800);});
  $('connect').addEventListener('click',connect);$('refresh').addEventListener('click',history);
  for (const id of ['from','to']) $(id).addEventListener('change',()=>{offset = 0;history();});
  let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer = setTimeout(()=>{offset = 0;history();},180);});
  $('previous').addEventListener('click',()=>{offset = Math.max(0,offset - 100);history();});
  $('next').addEventListener('click',()=>{offset += 100;history();});
  connect();
})();
