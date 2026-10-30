// Downloads the official toolchain used by Meta's Bubblewrap packaging tool.
const fs = require('node:fs/promises');
const path = require('node:path');
const { JdkInstaller } = require('./tooling/node_modules/@meta-quest/bubblewrap-cli/dist/lib/JdkInstaller.js');
const { AndroidSdkToolsInstaller } = require('./tooling/node_modules/@meta-quest/bubblewrap-cli/dist/lib/AndroidSdkToolsInstaller.js');
const { InquirerPrompt } = require('./tooling/node_modules/@meta-quest/bubblewrap-cli/dist/lib/Prompt.js');
const prompt = new InquirerPrompt();
(async()=>{
  const tools = path.resolve('apk/tooling');
  const jdkDir = path.join(tools,'jdk');
  const sdkDir = path.join(tools,'android-sdk');
  await fs.mkdir(jdkDir,{recursive:true}); await fs.mkdir(sdkDir,{recursive:true});
  const jdkPath = await new JdkInstaller(process,prompt).install(jdkDir);
  await new AndroidSdkToolsInstaller(process,prompt).install(sdkDir);
  await fs.writeFile(path.join(tools,'bubblewrap-config.json'),JSON.stringify({jdkPath,androidSdkPath:sdkDir},null,2));
  console.log('Java and Android tools installed.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
