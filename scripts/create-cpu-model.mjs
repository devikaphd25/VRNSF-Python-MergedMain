import fs from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// GLTFExporter uses FileReader in browsers. Provide binary support for Node.
globalThis.FileReader = class {
 readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}); }
 readAsDataURL(blob) { blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}); }
};
const cpu=new THREE.Group();cpu.name='CPU_Processor';
const materials={board:new THREE.MeshStandardMaterial({color:0x174d3b,roughness:.65}),metal:new THREE.MeshStandardMaterial({color:0xc9d0d6,metalness:.85,roughness:.3}),gold:new THREE.MeshStandardMaterial({color:0xd5a438,metalness:.8,roughness:.35}),dark:new THREE.MeshStandardMaterial({color:0x202830,roughness:.65})};
function box(name,x,y,z,w,h,d,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.name=name;m.position.set(x,y,z);cpu.add(m);return m;}
box('Circuit_Substrate',0,.017,0,.4,.034,.4,materials.board);
box('Package_Base',0,.04,0,.31,.012,.31,materials.dark);
box('Metal_Heat_Spreader',0,.057,0,.29,.022,.29,materials.metal);
// Bottom contact grid; dimensions in meters, Y up.
for(let i=0;i<12;i++)for(let j=0;j<12;j++){
 if(i>3&&i<8&&j>3&&j<8)continue;
 box(`Gold_Contact_${i}_${j}`,(i-5.5)*.03,-.004,(j-5.5)*.03,.017,.008,.017,materials.gold);
}
for(let i=0;i<8;i++)for(const side of [-1,1]){
 box(`Edge_Component_${side}_${i}`,side*.173,.039,(i-3.5)*.041,.012,.009,.021,materials.dark);
}
// Recess-like dark strokes spelling CPU, with real geometry (no font/textures).
const chars={C:[[0,0,1,0],[0,0,0,1],[0,1,1,1]],P:[[0,0,0,1],[0,0,1,0],[1,0,1,.5],[0,.5,1,.5]],U:[[0,0,0,1],[0,1,1,1],[1,0,1,1]]};
for(const [k,letter] of [...'CPU'].entries()) for(const [x1,z1,x2,z2] of chars[letter]){
 const s=.047,ox=-.084+k*.064,oz=-.026;
 box(`CPU_Label_${letter}`,ox+(x1+x2)*s/2,.0685,oz+(z1+z2)*s/2,Math.abs(x2-x1)*s+.004,.001,Math.abs(z2-z1)*s+.004,materials.dark);
}
const marker=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.001,12),materials.gold);marker.position.set(-.12,.069,.12);marker.name='Pin_One_Marker';cpu.add(marker);
// Batch the static parts by material to keep the VR draw-call count low.
cpu.updateMatrixWorld(true);
const batches=new Map();
for(const mesh of [...cpu.children]) {
 const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
 const list=batches.get(mesh.material) ?? [];list.push(geometry);batches.set(mesh.material,list);
 cpu.remove(mesh);
}
for(const [material,geometries] of batches){
 const mesh=new THREE.Mesh(mergeGeometries(geometries),material);
 mesh.name='CPU_'+Object.keys(materials).find(k=>materials[k]===material);cpu.add(mesh);
}
const exporter=new GLTFExporter();
const binary=await exporter.parseAsync(cpu,{binary:true});
await fs.mkdir('public/models/computer',{recursive:true});
await fs.writeFile('public/models/computer/cpu.glb',Buffer.from(binary));
const bytes=await fs.readFile('public/models/computer/cpu.glb');
if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid GLB');
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
console.log(JSON.stringify({file:'public/models/computer/cpu.glb',bytes:bytes.length,meshes:json.meshes.length,externalBuffers:json.buffers.some(b=>b.uri)}));
