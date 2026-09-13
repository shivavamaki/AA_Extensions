"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const code = fs.readFileSync(path.join(__dirname, "../src/shared/shared-data-client.js"), "utf8");
async function check(protocol, denied) {
  let writes = 0, posts = 0;
  const runtime = {lastError: null, sendMessage(msg, cb) { posts++; cb({ok:true}); }};
  const sandbox = {location:{protocol}, chrome:{runtime, storage:{
    local:{get(keys, cb){cb({});}},
    session:{set(data, cb){writes++; if(denied) runtime.lastError={message:"Access denied"}; cb(); runtime.lastError=null;},
      get(keys,cb){cb({});}}
  }}};
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  await sandbox.BKNData.setPatientContext({patientuid:"synthetic-patient", patientvisituid:"synthetic-visit"});
  assert.equal(writes, protocol === "chrome-extension:" ? 1 : 0);
  assert.equal(posts, 1);
  assert.equal((await sandbox.BKNData.getPatientContext()).patientuid, "synthetic-patient");
}
(async()=>{
  await check("https:", true);
  await check("chrome-extension:", false);
  await check("chrome-extension:", true);
  console.log("Patient context storage regression checks passed.");
})().catch(e=>{console.error(e);process.exitCode=1;});