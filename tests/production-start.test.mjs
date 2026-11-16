import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

function run({artifacts=true,envFile=true,hosting={}}={}) {
  const root=mkdtempSync(path.join(tmpdir(),'umes-production-start-'));
  try {
    mkdirSync(path.join(root,'server'));
    copyFileSync('server/start-production.mjs',path.join(root,'server/start-production.mjs'));
    if(envFile)writeFileSync(path.join(root,'.env.server'),'SUPABASE_URL=https://example.supabase.co\nSUPABASE_SECRET_KEY=test-private-key\nPORT=3100\n');
    if(artifacts){
      mkdirSync(path.join(root,'dist'));mkdirSync(path.join(root,'build'));
      writeFileSync(path.join(root,'dist/index.html'),'<html></html>');
      writeFileSync(path.join(root,'build/server.js'),`console.log(JSON.stringify({mode:process.env.NODE_ENV,serve:process.env.SERVE_WEB_APP,port:process.env.PORT,root:process.cwd()}));`);
    }
    const env={...process.env};
    for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','PORT','SERVE_WEB_APP','NODE_ENV'])delete env[key];
    Object.assign(env,hosting);
    const result=spawnSync(process.execPath,[path.join(root,'server/start-production.mjs')],{cwd:tmpdir(),env,encoding:'utf8'});
    return {...result,root:realpathSync(root)};
  } finally {rmSync(root,{recursive:true,force:true});}
}

test('production entry loads a local environment and starts compiled code from the project root',()=>{
  const result=run();
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{mode:'production',serve:'true',port:'3100',root:result.root});
});
test('hosting variables take precedence over a local environment file',()=>{
  const result=run({hosting:{PORT:'9090'}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).port,'9090');
});
test('production can use platform credentials without a local environment file',()=>{
  const result=run({envFile:false,hosting:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-key',PORT:'9090'}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).mode,'production');
});
test('missing artifacts and credentials fail before attempting to serve a broken app',()=>{
  const missingBuild=run({artifacts:false});
  assert.equal(missingBuild.status,1);
  assert.match(missingBuild.stderr,/npm run build/);
  const missingCredentials=run({envFile:false});
  assert.equal(missingCredentials.status,1);
  assert.match(missingCredentials.stderr,/Set SUPABASE_URL/);
});
