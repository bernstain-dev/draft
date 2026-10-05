// Required final regressions. No remote database/provider fallback.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const commands=[['npm',['run','build']],['node',['scripts/verify.mjs']],['node',['scripts/test-phase1.mjs']],['node',['scripts/test-phase2.mjs']],['node',['scripts/test-phase3.mjs']],['node',['scripts/test-phase4-readonly-reports.mjs']],['node',['scripts/check-edge.mjs']],['node',['scripts/test-phase4.mjs']],['node',['scripts/test-phase4-reports.mjs']],['node',['scripts/test-phase4-sql-browser.mjs']],['git',['diff','--check']]];
const results=[];
for(const [binary,args]of commands){
 const start=Date.now(),label=[binary,...args].join(' ');console.log('RUN '+label);
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true,shell:process.platform==='win32'&&binary==='npm'});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(binary!=='git')process.stdout.write(chunk);});child.stderr.on('data',chunk=>{stderr+=chunk;if(binary!=='git')process.stderr.write(chunk);});
  child.once('error',reject);child.once('exit',exitCode=>resolve({exitCode,stdout,stderr}));
 });
 // git --check can echo source lines. Store only safe metadata, never that body.
 const result={command:label,exitCode:output.exitCode,seconds:Number(((Date.now()-start)/1000).toFixed(2)),...(binary==='git'?{diagnosticCount:output.stdout.split(/\r?\n/).filter(line=>/^.+:\d+:/.test(line)).length,lineEndingWarnings:output.stderr.includes('LF will be replaced')}:{stdout:output.stdout,stderr:output.stderr})};
 results.push(result);writeFileSync('scripts/phase4-postfix-final-regression-results.json',JSON.stringify({timestamp:new Date().toISOString(),boundary:'Post-fix local verification; no hosted database, Auth, provider or deployment',results},null,2)+'\n');console.log((output.exitCode===0?'PASS ':'FAIL ')+label);
 if(output.exitCode!==0){process.exitCode=1;break;}
}
if(!process.exitCode){
 const baseline=JSON.parse(readFileSync('scripts/phase4-postfix-release-baseline.json','utf8'));
 for(const hashes of [baseline.sourceHashes,baseline.historicalReportHashes])for(const [file,expected]of Object.entries(hashes)){
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),expected,'Release freeze changed: '+file);
 }
 const freeze={sourceFiles:Object.keys(baseline.sourceHashes).length,historicalReports:Object.keys(baseline.historicalReportHashes).length,result:'PASS'};
 writeFileSync('scripts/phase4-postfix-final-regression-results.json',JSON.stringify({timestamp:new Date().toISOString(),boundary:'Post-fix local verification; no hosted database, Auth, provider or deployment',results,freeze},null,2)+'\n');
 console.log(`PASS freeze: ${freeze.sourceFiles} source/config/SQL/package files and ${freeze.historicalReports} historical reports unchanged.`);
}
