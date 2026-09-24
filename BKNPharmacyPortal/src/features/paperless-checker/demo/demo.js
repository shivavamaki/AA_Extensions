'use strict';
(() => {
const $=id=>document.getElementById(id),rx='RX-DEMO-042';
const names=['1 · Review','2 · Allocate & print','3 · Prepare','4 · Second check','Dispensed'];
const meds=[{code:'MED-A',name:'Demo medication A · 10 mg tablet',qty:'10 tablets'},{code:'MED-B',name:'Demo medication B · 5 mg tablet',qty:'6 tablets'}];
let step,events,session,scanned,paused,stopped,busy,uncertain,pending,generation=0;
let first,collector,checker,claimedAt,preparedAt,rxMatched,labelsChecked;
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function actor(){return step<2?{id:first||$('operator').value.trim(),role:'first_pharmacist'}:step===2?{id:collector||'Unassigned',role:'preparation_staff'}:{id:checker||'Unassigned',role:'second_pharmacist'};}
function log(event,detail){
events.push({id:session+'-'+(events.length+1),sequence:events.length+1,at:new Date().toISOString(),session,prescriptionNumber:rx,patient:'DEMO-HN-001',visit:'DEMO-V-001',operator:actor(),workstation:'DEMO-01',step:names[step],event,detail});
$('audit').innerHTML=[...events].reverse().map(e=>'<tr><td>'+e.sequence+' · '+new Date(e.at).toLocaleTimeString()+'</td><td>'+esc(e.operator.id)+'<br><small>'+esc(e.operator.role)+'</small></td><td>'+esc(e.event)+'</td><td>'+esc(e.detail)+'</td></tr>').join('');
$('event-count').textContent=events.length+' events';
}
function feedback(s,error=false){$('feedback').textContent=s;$('feedback').className=error?'error':'success';}
function move(n){const old=names[step];step=n;log('STEP_CHANGED',old+' → '+names[n]);render();}
function render(){
$('status').textContent=stopped?'Stopped':uncertain?'Needs reconciliation':busy?'Processing':paused?'Paused':names[step];
$('steps').innerHTML=names.map((s,i)=>'<li class="'+(i===step?'active':i<step?'done':'')+'">'+s+'</li>').join('');
$('patient').innerHTML='<strong>Demo Patient A</strong> · DEMO-HN-001<br>'+rx+' · DEMO-V-001 · Queue A042<br><small>Prescription already selected in the simulated ArcusAir workbench.</small>';
$('operator').disabled=step!==0||paused||stopped;
$('barcode').disabled=step!==3||!checker||paused||stopped||busy||uncertain;
$('scan-form').querySelector('button').disabled=$('barcode').disabled;
document.querySelectorAll('[data-scan]').forEach(b=>b.disabled=$('barcode').disabled);
$('pause').disabled=stopped||busy||uncertain||step===4;$('pause').textContent=paused?'Resume':'Pause';
$('stop').disabled=stopped||step===4;$('reset').disabled=busy;$('uncertain').disabled=busy||uncertain||stopped;
let html='';
if(stopped)html='<h2>Session stopped</h2><p>Export the audit trail before starting another demo session.</p>';
else if(uncertain)html='<h2>Outcome uncertain</h2><p>Verify the ArcusAir result before continuing.</p><button id="reconcile" class="primary">Simulate verified success</button>';
else if(busy)html='<h2>'+pending+'…</h2><p>Waiting for simulated ArcusAir confirmation.</p>';
else if(paused)html='<h2>Paused</h2><p>Resume to continue this prescription.</p>';
else if(step===0)html='<h2>Pharmacist 1 · Review prescription</h2><p>Review the prescription directly in ArcusAir. When finished, click Allocate. No prescription scan is required here.</p><button id="allocate" class="primary">Allocate · simulate ArcusAir button</button>';
else if(step===2){
html='<h2>Staff · Collect stickers and prepare</h2><div class="med"><div><strong>Printed sticker set</strong><br>'+rx+' · Demo Patient A<br><small>MED-A · 10 tablets / MED-B · 6 tablets</small></div><span>✓ Printed (demo)</span></div>';
if(!collector)html+='<p>Record who takes this sticker set before preparing the medicines.</p><label class="check">Prescription number <input id="claim-rx" value="'+rx+'"></label><label class="check">Staff ID / name <input id="staff" placeholder="e.g. STAFF-001"></label><button id="claim" class="primary">Record sticker collection</button>';
else html+='<div class="note">Collected by <strong>'+esc(collector)+'</strong><br>Prescription '+rx+'<br>'+esc(new Date(claimedAt).toLocaleString())+'</div><p>Prepare the medicines using the stickers.</p>'+meds.map(m=>'<div class="med">'+m.name+'<strong>'+m.qty+'</strong></div>').join('')+'<button id="prepared" class="primary">Prepared · send to second pharmacist</button>';
}else if(step===3){
html='<h2>Pharmacist 2 · Check medicines and stickers</h2>';
if(!checker)html+='<p>Enter the second pharmacist identity to begin checking.</p><label class="check">Pharmacist ID / name <input id="checker" placeholder="e.g. PHARM-002"></label><button id="start-check" class="primary">Start second check</button>';
else if(!rxMatched)html+='<p><strong>'+esc(checker)+'</strong> · scan the prescription number on the sticker first.</p><p>Expected prescription: <code>'+rx+'</code></p>';
else html+='<p>Sticker prescription matched to the simulated ArcusAir order. Scan each medicine code.</p>'+meds.map(m=>'<div class="med '+(scanned.has(m.code)?'checked':'')+'"><div><strong>'+m.name+'</strong><br><small>ArcusAir: '+m.code+' · '+m.qty+'</small></div><strong>'+(scanned.has(m.code)?'✓ Matched':'Awaiting scan')+'</strong></div>').join('')+'<label class="check"><input id="labels" type="checkbox" '+(labelsChecked?'checked':'')+'> Medicines, quantities, and stickers checked by second pharmacist</label><button id="dispense" class="primary" '+(scanned.size===meds.length&&labelsChecked?'':'disabled')+'>Dispensed · simulate ArcusAir button</button>';
}else if(step===4)html='<h2>✓ Dispensed</h2><p>Prescription '+rx+' is complete.</p><p>First pharmacist: '+esc(first)+'<br>Sticker collection / preparation: '+esc(collector)+'<br>Second pharmacist: '+esc(checker)+'</p><p>Export the audit trail to review each recorded step.</p>';
$('task').innerHTML=html;
if($('allocate'))$('allocate').onclick=()=>{first=$('operator').value.trim();if(!first){feedback('Enter the first pharmacist identity.',true);return;}log('MANUAL_REVIEW_COMPLETED','First pharmacist clicked Allocate after reviewing the prescription in ArcusAir');step=1;automate('Allocate and print stickers');};
if($('claim'))$('claim').onclick=()=>{const staff=$('staff').value.trim();if($('claim-rx').value.trim()!==rx){log('STICKER_COLLECTION_REJECTED','Prescription number does not match');feedback('Sticker prescription number does not match.',true);return;}if(!staff){feedback('Enter the staff identity collecting these stickers.',true);return;}collector=staff;claimedAt=new Date().toISOString();log('STICKERS_COLLECTED','Staff '+collector+' collected sticker set for '+rx);render();feedback('Sticker collection recorded by prescription number.');};
if($('prepared'))$('prepared').onclick=()=>{preparedAt=new Date().toISOString();log('PREPARATION_COMPLETED','Medicines prepared by '+collector);move(3);feedback('Second pharmacist: identify yourself, then scan the sticker prescription number.');};
if($('start-check'))$('start-check').onclick=()=>{const id=$('checker').value.trim();if(!id||id.toLowerCase()===first.toLowerCase()){feedback('Enter a second pharmacist different from the first pharmacist.',true);return;}checker=id;log('SECOND_CHECK_STARTED','Second pharmacist '+checker);render();$('barcode').focus();};
if($('labels'))$('labels').onchange=()=>{labelsChecked=$('labels').checked;log('MEDICINES_AND_STICKERS_CHECKED',labelsChecked?'Confirmed':'Confirmation removed');$('dispense').disabled=scanned.size!==meds.length||!labelsChecked;};
if($('dispense'))$('dispense').onclick=()=>{if(scanned.size===meds.length&&labelsChecked&&rxMatched){log('SECOND_CHECK_COMPLETED','Medicines and stickers checked against ArcusAir order');automate('Dispense');}};
if($('reconcile'))$('reconcile').onclick=()=>{log('RECONCILIATION',pending+' verified successful (simulation)');uncertain=false;completeAction();};
}
function completeAction(){
if(step===1){log('ALLOCATION_VERIFIED','ArcusAir allocation succeeded (simulation)');log('STICKERS_PRINTED','Sticker print completed (simulation; no printer connected)');$('arcus-state').textContent='Allocated';move(2);feedback('Stickers ready. Record the staff member collecting them.');}
else{log('DISPENSING_VERIFIED','ArcusAir status is Dispensed (simulation)');$('arcus-state').textContent='Dispensed';move(4);feedback('Dispensed. Workflow complete.');}
}
function automate(action){
pending=action;busy=true;const token=generation,fail=$('uncertain').checked;$('uncertain').checked=false;log('ACTION_INTENT',action+' for '+rx);render();
setTimeout(()=>{if(token!==generation)return;busy=false;if(stopped){log('ACTION_RESULT_UNCERTAIN',action+' interrupted; reconcile before retry');render();return;}if(fail){uncertain=true;log('ACTION_RESULT_UNCERTAIN',action+' response lost (simulation)');render();feedback('Reconcile the outcome before continuing.',true);return;}completeAction();},800);
}
function scan(value){
const code=value.trim();if(!code)return;if($('barcode').disabled)return;
if(!rxMatched){if(code!==rx){log('PRESCRIPTION_SCAN_REJECTED',code);feedback('Scan the prescription number on the sticker first: '+rx,true);return;}rxMatched=true;log('STICKER_PRESCRIPTION_MATCHED',rx+' matched to ArcusAir patient / visit / order (simulation)');render();feedback('Prescription matched. Now scan medicine codes.');$('barcode').focus();return;}
if(code===rx){log('DUPLICATE_PRESCRIPTION_SCAN',code);feedback('Prescription already matched. Scan a medicine code.',true);return;}
if(!meds.some(m=>m.code===code)){log('MEDICINE_SCAN_REJECTED',code+' not on ArcusAir order');feedback('Medicine code does not match this ArcusAir prescription.',true);return;}
if(scanned.has(code)){log('DUPLICATE_MEDICINE_SCAN',code);feedback('Already checked; quantity unchanged.',true);return;}
scanned.add(code);log('MEDICINE_MATCHED',code+' matches ArcusAir order (simulation)');render();feedback(scanned.size+'/'+meds.length+' medicines matched.');$('barcode').focus();
}
function reset(){generation++;step=0;events=[];scanned=new Set();paused=stopped=busy=uncertain=rxMatched=labelsChecked=false;first=collector=checker=claimedAt=preparedAt='';session='DEMO-'+Date.now();$('arcus-state').textContent='Ordered';$('barcode').value='';$('uncertain').checked=false;log('WORKBENCH_PRESCRIPTION_SELECTED',rx+' already open in ArcusAir (simulation)');render();feedback('First pharmacist reviews the selected prescription in ArcusAir, then clicks Allocate.');}
$('scan-form').onsubmit=e=>{e.preventDefault();const code=$('barcode').value;$('barcode').value='';scan(code);};
document.querySelectorAll('[data-scan]').forEach(b=>b.onclick=()=>scan(b.dataset.scan));
$('pause').onclick=()=>{paused=!paused;log(paused?'SESSION_PAUSED':'SESSION_RESUMED','Operator action');render();};
$('stop').onclick=()=>{stopped=true;log('SESSION_STOPPED',busy?'Action in progress; outcome requires reconciliation':'Operator stopped session');render();};
$('flow-toggle').onclick=()=>{$('flow').hidden=!$('flow').hidden;$('flow-toggle').textContent=$('flow').hidden?'View flowchart':'Hide flowchart';};
$('reset').onclick=()=>{if(confirm('Start a new demo session? Export first to keep this audit trail.'))reset();};
$('export').onclick=()=>{log('AUDIT_EXPORTED','Demo JSON export');const record={prescriptionNumber:rx,firstPharmacist:first,preparationStaff:collector,stickersCollectedAt:claimedAt,preparedAt,secondPharmacist:checker,status:names[step]};const url=URL.createObjectURL(new Blob([JSON.stringify({demo:true,session,prescriptions:{[rx]:record},events},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=session+'-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
reset();
})();

