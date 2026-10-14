import fs from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// GLTFExporter uses FileReader in browsers. Provide binary support for Node.
globalThis.FileReader = class {
 readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}); }
 readAsDataURL(blob) { blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}); }
};
const board=new THREE.Group();board.name='Educational_RAM_DIMM';
const materials={pcb:new THREE.MeshStandardMaterial({color:0x17613f,roughness:.65}),black:new THREE.MeshStandardMaterial({color:0x17202a,roughness:.55}),gold:new THREE.MeshStandardMaterial({color:0xdab653,metalness:.8,roughness:.3}),white:new THREE.MeshStandardMaterial({color:0xe7e9df,roughness:.8}),metal:new THREE.MeshStandardMaterial({color:0x949ca4,metalness:.65,roughness:.4})};
function box(name,x,y,z,w,h,d,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.name=name;m.position.set(x,y,z);board.add(m);}
// DIMM lies flat, Y up. Segmented substrate leaves a real key notch.
box('PCB_Main',0,0,-.005,.6,.008,.12,materials.pcb);
box('PCB_Lower_Left',-.133,0,.0625,.334,.008,.015,materials.pcb);
box('PCB_Lower_Right',.179,0,.0625,.242,.008,.015,materials.pcb);
for(const side of [-1,1]){
 for(let i=0;i<8;i++){
  const x=-.255+i*.073;
  box('Memory_IC',x,side*.008,-.005,.054,.008,.060,materials.black);
  for(let pin=0;pin<5;pin++)for(const edge of [-1,1])box('Chip_Lead',x+(pin-2)*.009,side*.0055,-.005+edge*.034,.004,.003,.007,materials.metal);
 }
 for(let i=0;i<60;i++){
  const x=-.29+i*.0098;
  if(x>.032 && x<.061)continue;
  box('Gold_Contact',x,side*.0048,.060,.006,.0016,.019,materials.gold);
 }
}
box('Identification_Label',-.085,.013,-.005,.15,.002,.045,materials.white);
// Minimal RAM lettering in geometry, avoiding external font or texture files.
const letters={R:[[0,0,0,1],[0,0,1,0],[1,0,1,.5],[0,.5,1,.5],[.5,.5,1,1]],A:[[0,1,0,0],[0,0,1,0],[1,0,1,1],[0,.5,1,.5]],M:[[0,1,0,0],[0,0,.5,.5],[.5,.5,1,0],[1,0,1,1]]};
for(const [i,char] of [...'RAM'].entries())for(const [a,b,c,d] of letters[char]){
 const x=-.143+i*.04,z=-.018,scale=.026;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.002,.001,Math.hypot(c-a,d-b)*scale+.002),materials.black);
 mesh.position.set(x+(a+c)*scale/2,.0145,z+(b+d)*scale/2);mesh.rotation.y=Math.atan2(c-a,d-b);board.add(mesh);
}
for(let i=0;i<12;i++)box('Small_Component',-.265+i*.048,.006,-.05,.012,.004,.005,materials.metal);
// Batch the static parts by material to keep the VR draw-call count low.
board.updateMatrixWorld(true);
const batches=new Map();
for(const mesh of [...board.children]) {
 const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
 const list=batches.get(mesh.material) ?? [];list.push(geometry);batches.set(mesh.material,list);
 board.remove(mesh);
}
for(const [material,geometries] of batches){
 const mesh=new THREE.Mesh(mergeGeometries(geometries),material);
 mesh.name='RAM_'+Object.keys(materials).find(k=>materials[k]===material);board.add(mesh);
}
const exporter=new GLTFExporter();
const binary=await exporter.parseAsync(board,{binary:true});
await fs.mkdir('public/models/computer',{recursive:true});
await fs.writeFile('public/models/computer/ram.glb',Buffer.from(binary));
const bytes=await fs.readFile('public/models/computer/ram.glb');
if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid GLB');
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
console.log(JSON.stringify({file:'public/models/computer/ram.glb',bytes:bytes.length,meshes:json.meshes.length,externalBuffers:json.buffers.some(b=>b.uri)}));
