(() => {
'use strict';
const KEY=Symbol.for('bkn.paperless.status.test'),route='#!/pharmacy/dispenseworkbench/pharmacy/dispense';
if(document[KEY]){document[KEY].show();return;}
const host=document.createElement('div');host.id='bkn-paperless-status-test';
const shadow=host.attachShadow({mode:'open'});
shadow.innerHTML=`<style>:host{position:fixed;right:24px;bottom:24px;z-index:10000;font:14px/1.5 Arial,sans-serif;color:#163747}*{box-sizing:border-box}.panel{width:350px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #b5d4d6;border-top:4px solid #087e86;border-radius:12px;box-shadow:0 10px 40px #1235;padding:18px}header{display:flex;justify-content:space-between;align-items:center}small{font-size:10px;color:#657c8b;letter-spacing:1px}h2{font-size:18px;margin:4px 0 14px}button{font:inherit;cursor:pointer;border:1px solid #c2d4dd;border-radius:7px;padding:10px;background:#fff;color:#163747}button.mode{display:block;width:100%;text-align:left;margin:8px 0}button.mode strong,button.mode span{display:block}button.mode span{font-size:12px;color:#627a89}button.active{background:#e3f4ef;border:2px solid #087e86}button:disabled{opacity:.5;cursor:wait}#message{padding:10px;background:#f0f6f8;border-radius:6px;font-size:13px;white-space:pre-wrap}#message.error{background:#fff0ee;color:#9a2938}#current{font-size:12px;color:#627a89}details{font-size:12px;margin-top:12px}ol{padding-left:20px;max-height:120px;overflow:auto}footer{margin-top:12px;font-size:11px;color:#627a89}#close{padding:3px 9px}.panel{max-height:calc(100vh - 48px);overflow:auto}#scanner{border-top:1px solid #d7e2e8;padding-top:12px;margin-top:12px}#scan-form{display:flex;gap:6px}#scan-input{min-width:0;width:100%;font:inherit;padding:9px;border:1px solid #abc4cf;border-radius:6px}#scan-input:focus{outline:2px solid #087e86}#scan-context,#scan-help{font-size:12px}#scan-reset{font-size:12px;padding:6px}#scan-list{overflow-wrap:anywhere}</style>
<section class="panel"><header><small>PAPERLESS CHECKER · TEST OVERLAY</small><button id="close" aria-label="Remove overlay">×</button></header><h2>Pharmacist worklist</h2>
<button class="mode" data-status="Ordered"><strong>1 · First check</strong><span>Review prescription · Ordered only</span></button>
<button class="mode" data-status="Second"><strong>2 · Second pharmacist</strong><span>Allocated + 4 partial statuses</span></button>
<p id="current"></p><p id="message" role="status" aria-live="polite">Choose your role to set the worklist status.</p><section id="scanner" hidden><strong>Second pharmacist · Scanner</strong><p id="scan-context">Scan prescription number on the sticker first.</p><form id="scan-form"><input id="scan-input" aria-label="Scanner barcode input" placeholder="Scan barcode · automatic receive" autocomplete="off" spellcheck="false" maxlength="160"><button id="scan-submit" type="submit">Receive</button></form><p id="scan-help">Auto-receive after 800 ms without input, or immediately on Enter / Tab. Scan each medicine row. All rows checked triggers Dispense when enabled. Code matching does not verify quantities.</p><button id="scan-reset" type="button">New prescription</button><ol id="scan-list" aria-live="polite"></ol></section><details><summary>Filter / scanner activity (this tab)</summary><ol id="log"></ol></details><footer>Sets Status and clicks Search. Scanner codes are held in this tab only. Close removes the overlay; the selected filter stays.</footer></section>`;
const $=s=>shadow.querySelector(s),buttons=[...shadow.querySelectorAll('[data-status]')];
let busy=false,mode='',disposed=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const onRoute=()=>location.hash.split('?')[0].replace(/\/$/,'')===route;
const normalized=s=>String(s||'').replace(/\s+/g,' ').trim();
const selected=o=>o.getAttribute('aria-selected')==='true'||o.hasAttribute('selected');
const label=o=>normalized(o.querySelector('.md-text')?.textContent||o.textContent);
const statusText=()=>{const e=document.querySelector('md-select#statusuid');return e?normalized(e.querySelector('md-select-value')?.textContent||e.getAttribute('aria-label')?.replace(/^Status:\s*/,'')):'';};
function message(text,error=false){$('#message').textContent=text;$('#message').className=error?'error':'';}
function record(text){const li=document.createElement('li');li.textContent=new Date().toLocaleTimeString()+' · '+text;$('#log').prepend(li);while($('#log').children.length>30)$('#log').lastChild.remove();}


const scanEvents=[];
let scannedPrescription='',lookupSerial=0;
const ROW_BODY='body > div.full-height.ng-scope.layout-row > div > md-content > md-content > div > md-card > md-content.padded-content-page.overflow-visible._md.md-incustheme-theme > div > md-table-container > div > div:nth-child(1) > table > tbody';
const DETAILS='md-content[ng-if="vm.showdetailspanel"]';
const SECOND_STATUSES=['Allocated','Partial Checkedin','Partially Allocated','Partially Cancelled','Partially Dispensed'];
const expectedStatuses=target=>target==='Second'?SECOND_STATUSES:['Ordered'];
const modeLabel=target=>expectedStatuses(target).join(', ');
function statusMatches(target){const parts=statusText().split(',').map(s=>s.trim().toLowerCase());const expected=expectedStatuses(target).map(s=>s.toLowerCase());return parts.length===expected.length&&expected.every(s=>parts.includes(s));}
function scannerReady(){return !disposed&&!busy&&onRoute()&&mode==='Second'&&statusMatches('Second');}

let scanTimer=null,medicineSnapshot=null;
const checkMarks=new Set(),checkedRows=new Set(),dispenseAttempts=new Set();
function resetMedicineChecks(){
clearTimeout(scanTimer);scanTimer=null;
for(const mark of checkMarks)mark.remove();
checkMarks.clear();checkedRows.clear();medicineSnapshot=null;
}
function medicineRows(panel){
const table=panel?.querySelector('table#ordertable');
if(!table)return [];
return [...table.querySelectorAll('tbody > tr[ng-repeat-start]')].filter(row=>row.getAttribute('ng-repeat-start').includes('selecteddispense.patientorderitems'));
}
function rowSignature(row){
const clone=row.cloneNode(true);clone.querySelectorAll('[data-bkn-medicine-check]').forEach(n=>n.remove());
return normalized(clone.textContent)+'|'+row.classList.contains('cancel-order');
}
function captureMedicines(){
const panel=matchingDetails(scannedPrescription),rows=medicineRows(panel);
if(!rows.length)throw Error('No medicine rows found in #ordertable. Automatic dispensing is blocked.');
const entries=rows.map(row=>{
const cell=row.querySelector('td[id^="showMonographcode"]');
const code=normalized(cell?.textContent);
if(!cell||!code)throw Error('A medicine row has no readable code. Automatic dispensing is blocked.');
return {row,cell,code,signature:rowSignature(row)};
});
medicineSnapshot={panel,entries};
}
function medicinesUnchanged(){
if(!medicineSnapshot||matchingDetails(scannedPrescription)!==medicineSnapshot.panel)return false;
const rows=medicineRows(medicineSnapshot.panel);
return rows.length===medicineSnapshot.entries.length&&medicineSnapshot.entries.every((e,i)=>rows[i]===e.row&&e.row.isConnected&&rowSignature(e.row)===e.signature);
}
function invalidateMedicineChecks(){
resetMedicineChecks();
message('Order contents changed. Previous check marks cleared. Scan the prescription again.',true);
record('Medicine checks invalidated by changed order details');
scannedPrescription='';$('#scan-context').textContent='Scan prescription again to reload current details.';
}
function checkMedicine(code){
if(!medicinesUnchanged()){invalidateMedicineChecks();return;}
const matches=medicineSnapshot.entries.filter(e=>e.code===code);
if(!matches.length){message('Medicine code does not match any row in this order.',true);record('Medicine scan rejected: no matching DOM code');return;}
const entry=matches.find(e=>!checkedRows.has(e.row));
if(!entry){message('This medicine is already checked. No additional row changed.');record('Duplicate medicine scan ignored');return;}
const mark=document.createElement('span');mark.setAttribute('data-bkn-medicine-check','');mark.setAttribute('role','img');mark.setAttribute('aria-label','Barcode checked');mark.textContent=' ✓ Checked';
mark.style.cssText='display:inline-block;margin-left:6px;color:#08775e;background:#e1f4eb;padding:2px 5px;border-radius:4px;font-weight:bold;font-size:12px;pointer-events:none';
entry.row.cells[0].append(mark);checkMarks.add(mark);checkedRows.add(entry.row);
addScan('medicine',code,'DOM code matched');record('Medicine row checked against DOM code');
$('#scan-context').textContent='Order '+scannedPrescription+' · '+checkedRows.size+'/'+medicineSnapshot.entries.length+' rows checked';
message('Medicine matched. '+checkedRows.size+'/'+medicineSnapshot.entries.length+' rows checked.');
maybeDispense();
}

let pendingFinal=null;
const finalRoute='#!/pharmacy/dispensetodept';
const currentRoute=()=>location.hash.split('?')[0].replace(/\/$/,'');
function advanceFinal(){
if(!pendingFinal||disposed)return;
if(pendingFinal.sent)return;
if(Date.now()>pendingFinal.deadline){
record('Final Dispense not clicked: transition/verification timed out');
message('Final Dispense was not clicked. Check the order and button in ArcusAir.',true);
pendingFinal=null;return;
}
if(currentRoute()!==finalRoute)return;
const cells=[...document.querySelectorAll('md-content td')].filter(td=>td.getClientRects().length&&!td.closest('md-content[ng-if="vm.showdetailspanel"]'));
const values=cells.map(td=>normalized(td.textContent));
if(!values.includes(pendingFinal.prescription)||!pendingFinal.codes.every(code=>values.includes(code))){
message('Waiting for the same prescription and medicine codes on the Dispense page.');return;
}
const candidates=[...document.querySelectorAll('button[aria-label="Dispense"][ng-click]')].filter(b=>b.getAttribute('ng-click').replace(/\s/g,'').replace(/;$/,'')==='vm.verifyDispense()'&&b.getClientRects().length);
if(candidates.length!==1||candidates[0].disabled||candidates[0].getAttribute('aria-disabled')==='true'){
message('Waiting for the final Dispense button to become enabled.');return;
}
pendingFinal.sent=true; // Latch before the click, including any synchronous navigation.
record('Same prescription and medicine codes verified; clicking vm.verifyDispense once');
candidates[0].click();
message('Final Dispense clicked. Await ArcusAir result; no automatic retry.');
record('Final Dispense click sent; server completion is not verified');
}


function maybeDispense(){
if(!scannerReady()||!medicineSnapshot||dispenseAttempts.has(scannedPrescription))return;
if(!medicinesUnchanged()){invalidateMedicineChecks();return;}
if(!medicineSnapshot.entries.length||checkedRows.size!==medicineSnapshot.entries.length)return;
if(medicineSnapshot.entries.some(e=>e.row.classList.contains('cancel-order'))){message('A row is cancelled or discontinued. Automatic Dispense is blocked; review in ArcusAir.',true);return;}
const button=medicineSnapshot.panel.querySelector('button#dispensetodept');
if(!button||button.disabled||button.getAttribute('aria-disabled')==='true'||!button.getClientRects().length){
message('All rows checked. ArcusAir Dispense is disabled or unavailable; waiting for it to become enabled.');return;
}
// Recheck the same order and unchanged row set immediately before the one permitted click.
if(!medicinesUnchanged())return;
dispenseAttempts.add(scannedPrescription);
pendingFinal={prescription:scannedPrescription,codes:[...new Set(medicineSnapshot.entries.map(e=>e.code))],deadline:Date.now()+30000,sent:false};
record('All medicine rows checked; clicking #dispensetodept once');
button.click();
message('Opening Dispense page; waiting to verify and click final Dispense.');
record('Dispense click sent; completion is not yet verified');
syncScanner();
}
function submitScanner(){
clearTimeout(scanTimer);scanTimer=null;
if(!scannerReady()||dispenseAttempts.has(scannedPrescription))return;
const input=$('#scan-input'),value=input.value;
input.value='';receiveScan(value);
}


function clearScanner(){
pendingFinal=null;
resetMedicineChecks();
lookupSerial++;scannedPrescription='';scanEvents.length=0;$('#scan-input').value='';$('#scan-list').replaceChildren();
$('#scan-context').textContent='Scan prescription number beginning I, O, or E.';
}
function syncScanner(){
$('#scanner').hidden=mode!=='Second'||!onRoute();
const ready=scannerReady();
$('#scan-input').disabled=!ready||dispenseAttempts.has(scannedPrescription);$('#scan-submit').disabled=$('#scan-input').disabled;$('#scan-reset').disabled=!ready;
}
function addScan(kind,code,verification){
const duplicate=scanEvents.some(e=>e.prescription===scannedPrescription&&e.kind===kind&&e.code===code);
scanEvents.push({at:new Date().toISOString(),prescription:scannedPrescription,kind,code,duplicate,verification});
const item=document.createElement('li');item.textContent=(kind==='prescription'?'Prescription':'Medicine')+': '+code+(duplicate?' · duplicate':'')+' · '+verification;
$('#scan-list').prepend(item);while($('#scan-list').children.length>8)$('#scan-list').lastChild.remove();
if(scanEvents.length>200)scanEvents.shift();
}
function matchingDetails(code){
return [...document.querySelectorAll(DETAILS)].find(panel=>panel.getClientRects().length&&[...panel.querySelectorAll('h4')].some(h=>normalized(h.textContent).match(/\(([^()]*)\)\s*$/)?.[1]===code));
}
async function lookupPrescription(code){
busy=true;const serial=++lookupSerial;syncScanner();buttons.forEach(b=>b.disabled=true);
const valid=()=>{if(disposed||serial!==lookupSerial||!onRoute()||mode!=='Second'||!statusMatches('Second'))throw Error('Lookup cancelled because the page or status changed.');};
let observer;
message('Searching order '+code+'…');record('Prescription lookup started');
try{
valid();
const field=document.querySelector('input#ordernumber');
if(!field||field.disabled||field.readOnly)throw Error('Order Number input is missing or disabled.');
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,code);
field.dispatchEvent(new Event('input',{bubbles:true}));
field.dispatchEvent(new Event('change',{bubbles:true}));
// ng-model receives input/change. Do not also trigger ng-blur search.
await delay(60);valid();
if(field.value!==code)throw Error('ArcusAir did not retain the scanned Order Number.');
const search=await waitFor(()=>{valid();const b=document.querySelector('button#searchdispense');return b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'?b:null;},3000,'Search is missing or disabled. Check required ArcusAir filters.');
const before=document.querySelector(ROW_BODY);
const oldRows=before?[...before.children]:[];
let fresh=false,lastChange=0;
observer=new MutationObserver(records=>{
const current=document.querySelector(ROW_BODY);
const replaced=current!==before||!!current&&[...current.children].some((r,i)=>r!==oldRows[i]);
const touched=records.some(r=>(before&&before.contains(r.target))||(current&&current.contains(r.target)));
if(replaced||touched){fresh=true;lastChange=Date.now();}
});
observer.observe(document.body,{childList:true,subtree:true,characterData:true});
valid();search.click();record('Order Number filled; clicked #searchdispense');
const row=await waitFor(()=>{
valid();
if(field.value!==code)throw Error('Order Number changed during lookup; no row opened.');
const body=document.querySelector(ROW_BODY);
if(!fresh||Date.now()-lastChange<250||!body)return null;
const first=[...body.children].find(r=>r.tagName==='TR'&&r.getClientRects().length&&r.querySelector('td'));
if(!first)return null;
// Exact cell comparison avoids a substring or an unrelated old row.
return [...first.querySelectorAll('td')].some(td=>normalized(td.textContent)===code)?first:null;
},12000,'No fresh first result matching this prescription. Check the search filters and try again.');
observer.disconnect();valid();
if(!row.isConnected)throw Error('Result changed before opening. Scan the prescription again.');
row.click();record('Opened first row after exact order-number match');
await waitFor(()=>{valid();return matchingDetails(code);},8000,'Details panel did not confirm this order number. Scan again after checking ArcusAir.');
valid();scannedPrescription=code;captureMedicines();addScan('prescription',code,'order details verified');
$('#scan-context').textContent='Order '+code+' opened · scan medicine codes next.';
message('Matching order opened. Scan each medicine code; all rows checked will trigger Dispense.');
record('Details heading verified for scanned prescription');
}catch(e){
scannedPrescription='';$('#scan-context').textContent='Lookup failed. Scan prescription number again.';
message(e.message,true);record('Prescription lookup not completed: '+e.message);
}finally{
observer?.disconnect();busy=false;buttons.forEach(b=>b.disabled=false);refresh();syncScanner();
if(scannerReady())$('#scan-input').focus();
}
}
function receiveScan(raw){
if(!scannerReady()){record('Scan ignored: second pharmacist mode is not ready');return;}
const code=raw.trim();
if(!code)return;
if(code.length>160||/[\x00-\x1f\x7f]/.test(code)){message('Barcode rejected: unsupported length or control characters.',true);return;}
if(!scannedPrescription){
if(!/^[IOE]/.test(code)){message('Invalid prescription number: first letter must be I, O, or E.',true);record('Prescription rejected: invalid prefix');return;}
lookupPrescription(code);return;
}
if(code===scannedPrescription){message('This prescription is already open. Scan medicine codes, or choose New prescription.');record('Duplicate prescription ignored');return;}
if(!matchingDetails(scannedPrescription)){clearScanner();message('The open order details changed. Scan the prescription number again.',true);return;}
checkMedicine(code);
$('#scan-input').focus();
}


function assertPage(select){if(disposed||!onRoute()||!select.isConnected)throw Error('Page changed. Return to the dispense workbench and choose the role again.');}
async function waitFor(fn,ms=3000,errorText='ArcusAir did not respond in time. Check the Status selector and try again.'){const end=Date.now()+ms;do{const v=fn();if(v)return v;await delay(60);}while(Date.now()<end);throw Error(errorText);}
function containerFor(select){
const ids=(select.getAttribute('aria-owns')||select.getAttribute('aria-controls')||'').split(/\s+/).filter(Boolean);
return ids.map(id=>document.getElementById(id)).find(e=>e&&e.querySelector('md-option'));
}
async function closeMenu(select){
if(select.getAttribute('aria-expanded')==='false')return;
const backdrops=[...document.querySelectorAll('md-backdrop.md-select-backdrop,.md-select-backdrop')];
const backdrop=backdrops.find(e=>e.getClientRects().length);
if(backdrop)backdrop.click();
else {const menu=containerFor(select)?.querySelector('md-select-menu')||select;menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));}
await waitFor(()=>select.getAttribute('aria-expanded')==='false');
}
async function apply(target){
if(busy||disposed)return;
if(!onRoute()){message('Open the ArcusAir dispense workbench first.',true);return;}
const select=document.querySelector('md-select#statusuid');
if(!select){message('Status selector #statusuid is not available yet. Wait for the workbench to load.',true);return;}
if(select.getAttribute('aria-disabled')==='true'||select.hasAttribute('disabled')){message('ArcusAir has disabled the Status selector.',true);return;}
busy=true;clearScanner();syncScanner();buttons.forEach(b=>b.disabled=true);$('#close').disabled=true;
message('Setting '+modeLabel(target)+'…');record('Requested '+modeLabel(target)+'');
try{
assertPage(select);
if(select.getAttribute('aria-expanded')!=='true')select.click();
const container=await waitFor(()=>{const c=containerFor(select);return c&&c.getClientRects().length&&c.querySelectorAll('md-option').length?c:null;});
assertPage(select);
const options=[...container.querySelectorAll('md-option')];

const desired=expectedStatuses(target).map(name=>{
const matches=options.filter(o=>label(o).toLowerCase()===name.toLowerCase());
if(matches.length!==1)throw Error('Cannot identify status: '+name+'. No status changes applied.');
if(matches[0].hasAttribute('disabled')||matches[0].getAttribute('aria-disabled')==='true')throw Error(name+' is disabled.');
return matches[0];
});
const all=options.find(o=>label(o).toLowerCase()==='all');
if(all&&selected(all)){all.click();await waitFor(()=>!selected(all));}
for(const option of desired){assertPage(select);if(!selected(option)){option.click();await waitFor(()=>selected(option));}}
for(const other of options){assertPage(select);if(!desired.includes(other)&&selected(other)){if(other.hasAttribute('disabled')||other.getAttribute('aria-disabled')==='true')throw Error('Another status cannot be cleared.');other.click();await waitFor(()=>!selected(other));}}
const chosen=options.filter(selected);
if(chosen.length!==desired.length||!desired.every(o=>chosen.includes(o)))throw Error('Exact status selection could not be verified.');
assertPage(select);
await closeMenu(select); // Normal md-on-close runs vm.updateStatus().
await waitFor(()=>statusMatches(target));
assertPage(select);mode=target;buttons.forEach(b=>b.classList.toggle('active',b.dataset.status===mode));
const search=await waitFor(()=>{const button=document.querySelector('button#searchdispense');return button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'?button:null;});
assertPage(select);
if(!statusMatches(target))throw Error('Status changed before Search; choose the mode again.');
search.click();
message(modeLabel(target)+' is set. Search clicked.'+(target==='Second'?' Scan the prescription number on the sticker.':''));
record('Verified '+modeLabel(target)+'; clicked #searchdispense (result loading not verified)');
}catch(e){mode='';buttons.forEach(b=>b.classList.remove('active'));message(e.message,true);record('Not verified: '+e.message);try{if(select.isConnected)await closeMenu(select);}catch(_){}}
finally{busy=false;buttons.forEach(b=>b.disabled=false);$('#close').disabled=false;refresh();syncScanner();if(scannerReady())$('#scan-input').focus();}
}

let standbyPending=false,standbyBusy=false;
function focusScanner(){
if(!scannerReady()||$('#scan-input').disabled||host.hidden||document.visibilityState==='hidden')return;
if([...document.querySelectorAll('md-dialog,[role="dialog"],md-select[aria-expanded="true"]')].some(e=>e.getClientRects().length))return;
if(shadow.activeElement!==$('#scan-input'))$('#scan-input').focus({preventScroll:true});
}
async function resumeStandby(){
if(!standbyPending||standbyBusy||disposed||!onRoute()||busy)return;
const field=document.querySelector('input#ordernumber'),status=document.querySelector('md-select#statusuid');
if(!field||!status||field.disabled)return;
standbyBusy=true;standbyPending=false;
try{
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'');
field.dispatchEvent(new Event('input',{bubbles:true}));
field.dispatchEvent(new Event('change',{bubbles:true}));
if(!statusMatches('Second'))await apply('Second');
else {mode='Second';buttons.forEach(b=>{b.disabled=false;b.classList.toggle('active',b.dataset.status==='Second');});}
if(!disposed&&onRoute()&&statusMatches('Second')){
$('#scan-context').textContent='Standby · scan the next prescription number (I, O, or E).';
message('Ready for the next prescription. Scanner input is focused.');
record('Returned to workbench; scanner standby restored (previous server result not inferred)');
syncScanner();focusScanner();
}
}finally{standbyBusy=false;}
}


function refresh(){
if(disposed)return;
if(pendingFinal){
if(currentRoute()===finalRoute){
host.hidden=false;$('#scanner').hidden=true;buttons.forEach(b=>b.disabled=true);
$('#current').textContent='Final Dispense · '+pendingFinal.prescription;
advanceFinal();return;
}
if(!onRoute()){pendingFinal=null;record('Final Dispense cancelled: unrelated navigation');}
else if(pendingFinal.sent){pendingFinal=null;clearScanner();standbyPending=true;buttons.forEach(b=>b.disabled=false);}
else advanceFinal();
}
host.hidden=!onRoute();if(!onRoute()&&mode){standbyPending=false;mode='';clearScanner();buttons.forEach(b=>b.classList.remove('active'));}
const text=statusText();$('#current').textContent='Current ArcusAir Status: '+(text||'not available');
if(mode&&!statusMatches(mode)&&!busy&&!standbyPending&&!standbyBusy){mode='';clearScanner();buttons.forEach(b=>b.classList.remove('active'));message('ArcusAir Status changed. Choose the role again to apply its filter.');}
}
$('#scan-form').onsubmit=e=>{e.preventDefault();submitScanner();};
$('#scan-input').addEventListener('input',e=>{
clearTimeout(scanTimer);
if(e.isComposing||!scannerReady())return;
scanTimer=setTimeout(()=>{if(shadow.activeElement===$('#scan-input'))submitScanner();},800);
});
$('#scan-input').addEventListener('keydown',e=>{
if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();submitScanner();}
});
$('#scan-input').addEventListener('blur',()=>clearTimeout(scanTimer));
$('#scan-reset').onclick=()=>{clearScanner();record('Scanner reset for next prescription');$('#scan-input').focus();};
buttons.forEach(b=>b.onclick=()=>apply(b.dataset.status));
$('#close').onclick=()=>{disposed=true;clearInterval(timer);window.removeEventListener('hashchange',refresh);standbyPending=false;pendingFinal=null;resetMedicineChecks();host.remove();lookupSerial++;delete document[KEY];};
document[KEY]={show(){host.hidden=false;refresh();}};
document.documentElement.append(host);
window.addEventListener('hashchange',refresh);const timer=setInterval(()=>{refresh();syncScanner();maybeDispense();resumeStandby();focusScanner();},500);refresh();syncScanner();
})();

