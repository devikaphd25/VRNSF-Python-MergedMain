import fs from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// GLTFExporter uses FileReader in browsers. Provide binary support for Node.
globalThis.FileReader = class {
 readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}); }
 readAsDataURL(blob) { blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}); }
};
const board=new THREE.Group();board.name='Educational_Motherboard';
const materials={
 pcb:new THREE.MeshStandardMaterial({color:0x164c3b,roughness:.7}),
 black:new THREE.MeshStandardMaterial({color:0x202733,roughness:.6}),
 metal:new THREE.MeshStandardMaterial({color:0xbfcbd4,metalness:.8,roughness:.3}),
 gold:new THREE.MeshStandardMaterial({color:0xd4a943,metalness:.65,roughness:.45}),
 blue:new THREE.MeshStandardMaterial({color:0x267db2,roughness:.5}),
 white:new THREE.MeshStandardMaterial({color:0xe0e5df,roughness:.6})};
function box(name,x,y,z,w,h,d,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.name=name;m.position.set(x,y,z);board.add(m);}
function cylinder(name,x,y,z,r,h,mat){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,16),mat);m.name=name;m.position.set(x,y,z);board.add(m);}
box('PCB',0,0,0,.60,.009,.48,materials.pcb);
// CPU socket and installed processor, upper half of the board.
box('CPU_Socket',-.045,.014,-.09,.145,.021,.14,materials.black);
box('CPU_Chip',-.045,.029,-.09,.105,.011,.10,materials.metal);
box('Retention_Lever',.032,.024,-.09,.006,.006,.145,materials.metal);
// Four DIMM slots with contrasting latches and narrow contact channels.
for(let i=0;i<4;i++){
 const x=.095+i*.028;
 box('RAM_Slot',x,.022,-.085,.019,.034,.235,i%2?materials.black:materials.blue);
 box('RAM_Channel',x,.040,-.085,.007,.002,.205,materials.black);
 for(const z of [-.21,.04])box('RAM_Latch',x,.028,z,.024,.038,.014,materials.white);
}
// Expansion slots and CMOS battery.
for(let i=0;i<3;i++){
 const z=.08+i*.055;
 box('PCIe_Slot',-.075,.018,z,.255,.026,.019,i===0?materials.blue:materials.black);
 box('PCIe_Channel',-.075,.032,z,.235,.002,.007,materials.gold);
 box('PCIe_Latch',.062,.025,z,.015,.026,.025,materials.white);
}
cylinder('CMOS_Battery',.12,.015,.125,.027,.014,materials.metal);
// Chipset heatsink and power connectors.
box('Chipset',.213,.015,.13,.073,.018,.072,materials.black);
for(let i=0;i<8;i++)box('Heatsink_Fin',.184+i*.008,.029,.13,.003,.016,.068,materials.metal);
box('ATX_24Pin',.272,.026,-.075,.026,.045,.115,materials.black);
for(let row=0;row<2;row++)for(let i=0;i<12;i++)box('Power_Pin',.265+row*.013,.050,-.125+i*.009,.005,.003,.005,materials.gold);
for(let i=0;i<4;i++)box('SATA_Port',.256,.02,.19-i*.027,.055,.03,.020,materials.blue);
// Rear I/O housings with visible dark connector openings.
for(let i=0;i<5;i++){
 const z=-.185+i*.07;
 box('Rear_IO',-.271,.033,z,.049,.057,.055,materials.metal);
 box('Port_Opening',-.297,.032,z,.002,.032,.038,materials.black);
}
for(let i=0;i<9;i++){
 const z=-.195+i*.022;
 cylinder('Capacitor',-.153,.023,z,.008,.037,materials.black);
 cylinder('Capacitor_Top',-.153,.043,z,.007,.003,materials.metal);
}
for(let i=0;i<10;i++){
 box('VRM',-.19,.014,-.185+i*.022,.024,.018,.014,materials.black);
 box('PCB_Trace',-.025+i*.022,.0055,.215,.001,.001,.02,materials.gold);
}
for(const x of [-.278,.278])for(const z of [-.22,.22]){
 cylinder('Mounting_Pad',x,.006,z,.009,.002,materials.gold);
 cylinder('Mounting_Hole',x,.0075,z,.004,.002,materials.black);
}
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
 mesh.name='Motherboard_'+Object.keys(materials).find(k=>materials[k]===material);board.add(mesh);
}
const exporter=new GLTFExporter();
const binary=await exporter.parseAsync(board,{binary:true});
await fs.mkdir('public/models/computer',{recursive:true});
await fs.writeFile('public/models/computer/motherboard.glb',Buffer.from(binary));
const bytes=await fs.readFile('public/models/computer/motherboard.glb');
if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid GLB');
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
console.log(JSON.stringify({file:'public/models/computer/motherboard.glb',bytes:bytes.length,meshes:json.meshes.length,externalBuffers:json.buffers.some(b=>b.uri)}));
