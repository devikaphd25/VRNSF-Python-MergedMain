// Run from the project root: node apk/rebuild-test-apk.cjs https://NEW.trycloudflare.com
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchOrigin } = require('./update-config.cjs');
(async()=>{
  if (!process.argv[2]) throw Error('Usage: node apk/rebuild-test-apk.cjs https://NEW.trycloudflare.com');
  const origin=launchOrigin(process.argv[2]);
  for (const file of ['apk/signing/umes-vr-test.keystore','apk/signing/test-signing.json']) {
    await fs.access(file).catch(()=>{throw Error(`Required signing file missing: ${file}. Restore it from backup.`);});
  }
  const response=await fetch(origin+'/manifest.webmanifest');
  if(!response.ok)throw Error(`New host manifest returned HTTP ${response.status}; start the server and tunnel first.`);
  const manifest=await response.json();
  if(!manifest.name||!manifest.start_url)throw Error('The new host does not serve the app manifest.');
  const config=JSON.parse(await fs.readFile('apk/runtime.json','utf8'));
  config.origin=origin;
  await fs.writeFile('apk/runtime.json',JSON.stringify(config,null,2)+'\n');
  execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{stdio:'inherit'});
  for(const helper of ['generate-project.cjs','sign-and-build.cjs','verify-test-apk.cjs']) {
    execFileSync(process.execPath,[path.join('apk',helper)],{stdio:'inherit'});
  }
  console.log('Update complete. The original package ID and signing key were retained.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
