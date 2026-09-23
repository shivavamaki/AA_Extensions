const fs=require('node:fs'), path=require('node:path');
const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../manifest.json'),'utf8'));
const prefix='src/features/automate/';
module.exports={...manifest,content_scripts:manifest.content_scripts.filter(s=>s.js?.includes(prefix+'content/tab-settings.js')).map(s=>({...s,js:s.js.map(f=>f.slice(prefix.length)),css:s.css.map(f=>f.slice(prefix.length))}))};
