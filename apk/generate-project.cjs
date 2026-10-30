const fs = require('node:fs/promises');
const path = require('node:path');
const { TwaManifest,TwaGenerator,ConsoleLog } = require('./tooling/node_modules/@meta-quest/bubblewrap-core');
const { generateManifestChecksumFile } = require('./tooling/node_modules/@meta-quest/bubblewrap-cli/dist/lib/cmds/shared.js');
const { nextVersion } = require("./update-config.cjs");
(async()=>{
  const runtime=JSON.parse(await fs.readFile('apk/runtime.json','utf8'));
  let previous = null;
  try { previous = JSON.parse(await fs.readFile('apk/android/twa-manifest.json','utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const version = nextVersion(previous, runtime.packageId);
  if (previous) await fs.access(path.resolve('apk/signing/umes-vr-test.keystore'));
  const manifest=await TwaManifest.fromWebManifest(`${runtime.origin}/manifest.webmanifest`);
  manifest.packageId=runtime.packageId;
  manifest.appVersionCode = version.code;
  manifest.appVersionName = version.name;
  manifest.name='UMES VR Classroom Test';
  manifest.launcherName='UMES VR Test';
  manifest.isMetaQuest=true;
  manifest.horizonOSAppMode='immersive';
  manifest.minSdkVersion=23;
  manifest.enableNotifications=false;
  manifest.enableSiteSettingsShortcut=false;
  manifest.enableMicrophone=false;
  manifest.features={horizonPlatformSDK:{enabled:true}};
  manifest.signingKey={path:path.resolve('apk/signing/umes-vr-test.keystore'),alias:'umes-vr-test'};
  const target=path.resolve('apk/android');
  await fs.mkdir(target,{recursive:true});
  await manifest.saveToFile(path.join(target,'twa-manifest.json'));
  await new TwaGenerator().createTwaProject(target,manifest,new ConsoleLog('UMES APK'));
  await generateManifestChecksumFile(path.join(target,'twa-manifest.json'),target);
  console.log(`Generated immersive Quest Android project: version ${version.name} (code ${version.code}).`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
