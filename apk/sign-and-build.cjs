// Creates a local test signing key, publishes its public fingerprint, then builds the APK.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Config,JdkHelper } = require('./tooling/node_modules/@meta-quest/bubblewrap-core');
const { build } = require('./tooling/node_modules/@meta-quest/bubblewrap-cli/dist/lib/cmds/build.js');
const { generateManifestChecksumFile } = require('./tooling/node_modules/@meta-quest/bubblewrap-cli/dist/lib/cmds/shared.js');
let signingSecret = "";
(async()=>{
  const root=process.cwd();
  const configData=JSON.parse(await fs.readFile('apk/tooling/bubblewrap-config.json','utf8'));
  const config=new Config(configData.jdkPath,configData.androidSdkPath);
  const javaHome=new JdkHelper(process,config).getJavaHome();
  const signingDir=path.resolve('apk/signing');
  await fs.mkdir(signingDir,{recursive:true,mode:0o700});
  const secretsFile=path.join(signingDir,'test-signing.json');
  let secrets;
  try { secrets=JSON.parse(await fs.readFile(secretsFile,'utf8')); }
  catch(error){if(error.code!=='ENOENT')throw error;secrets={password:crypto.randomBytes(32).toString('base64url')};await fs.writeFile(secretsFile,JSON.stringify(secrets),{mode:0o600});}
  signingSecret = secrets.password;
  const keyStore=path.join(signingDir,'umes-vr-test.keystore');
  try { await fs.access('apk/UMES-VR-Classroom-test.apk');
    await fs.access(keyStore);
  } catch (error) {
    if (error.code !== 'ENOENT' || error.path === keyStore) throw Error('The existing signing key is required for an APK update. Restore apk/signing/ from backup.');
  }
  const env={...process.env,UMES_TEST_KEY_PASSWORD:secrets.password};
  try {await fs.access(keyStore);}catch{
    execFileSync(path.join(javaHome,'bin/keytool'),['-genkeypair','-keystore',keyStore,'-alias','umes-vr-test','-storetype','PKCS12','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=UMES VR Classroom Test, OU=Classroom, O=UMES, C=US','-storepass:env','UMES_TEST_KEY_PASSWORD','-keypass:env','UMES_TEST_KEY_PASSWORD'],{env,stdio:['ignore','pipe','pipe']});
    await fs.chmod(keyStore,0o600);
  }
  const details=execFileSync(path.join(javaHome,'bin/keytool'),['-list','-v','-keystore',keyStore,'-alias','umes-vr-test','-storepass:env','UMES_TEST_KEY_PASSWORD'],{env,encoding:'utf8'});
  const fingerprint=details.match(/SHA256:\s*([0-9A-F:]+)/i)?.[1];
  if(!fingerprint)throw Error('Signing certificate fingerprint not found');
  const runtime=JSON.parse(await fs.readFile('apk/runtime.json','utf8'));
  const assetlinks=[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:runtime.packageId,sha256_cert_fingerprints:[fingerprint]}}];
  for(const folder of ['public/.well-known','dist/.well-known']){
    await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,'assetlinks.json'),JSON.stringify(assetlinks,null,2)+'\n');
  }
  const androidDir=path.resolve('apk/android');
  const manifestFile=path.join(androidDir,'twa-manifest.json');
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  manifest.fingerprints=[{name:'UMES VR Test',value:fingerprint}];
  await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  await generateManifestChecksumFile(manifestFile,androidDir);
  const gradle=path.join(androidDir,'build.gradle');
  await fs.writeFile(gradle,(await fs.readFile(gradle,'utf8')).replaceAll('jcenter()','mavenCentral()'));
  if (process.argv.includes('--prepare-only')) {
    console.log('Signing key and Digital Asset Links prepared.');
    return;
  }
  const verificationResponse = await fetch(runtime.origin + '/.well-known/assetlinks.json');
  const hostedLinks = await verificationResponse.json();
  if (!verificationResponse.ok || hostedLinks[0]?.target?.package_name !== runtime.packageId
      || !hostedLinks[0]?.target?.sha256_cert_fingerprints?.includes(fingerprint)) {
    throw Error('Hosted Digital Asset Links do not match this APK signing identity.');
  }
  console.log('Hosted Digital Asset Links match the APK certificate.');
  process.env.BUBBLEWRAP_KEYSTORE_PASSWORD=secrets.password;
  process.env.BUBBLEWRAP_KEY_PASSWORD=secrets.password;
  process.env.GRADLE_USER_HOME=path.resolve('apk/tooling/gradle-cache');
  process.chdir(androidDir);
  const ok=await build(config,{manifest:manifestFile});
  if(!ok)throw Error('APK build did not complete');
  process.chdir(root);
  await fs.copyFile(path.join(androidDir,'app-release-signed.apk'),'apk/UMES-VR-Classroom-test.apk');
  console.log('APK saved: apk/UMES-VR-Classroom-test.apk');
})().catch(error=>{console.error(signingSecret ? String(error.message).replaceAll(signingSecret,"[redacted]") : error.message);process.exitCode=1;});
