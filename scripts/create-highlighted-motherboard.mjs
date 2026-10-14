import fs from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// GLTFExporter uses FileReader in browsers. Provide binary support for Node.
globalThis.FileReader = class {
 readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();}); }
 readAsDataURL(blob) { blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();}); }
};
const board=new THREE.Group();board.name='Reference_Motherboard_Main_Parts';
board.userData.description='Simplified educational legacy motherboard inspired by the reference; not a manufacturing replica.';
const mat=(color,metalness=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.55});
const materials={pcb:mat(0x263c46),black:mat(0x252a30),metal:mat(0x78858b,.6),cpu:mat(0xffa63d),ram:mat(0x329cff),chipset:mat(0x32d6c4),expansion:mat(0xb391ff),power:mat(0xffdc55)};
function box(name,x,y,z,w,h,d,m){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.name=name;o.position.set(x,y,z);board.add(o);}
function cylinder(name,x,y,z,r,h,m){const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,20),m);o.name=name;o.position.set(x,y,z);board.add(o);}
box('PCB',0,0,0,.6,.008,.48,materials.pcb);
// Large empty CPU socket at the front left, as in the supplied reference.
box('CPU_Socket',-.12,.019,.10,.14,.03,.13,materials.cpu);
box('Socket_Recess',-.12,.036,.10,.065,.003,.06,materials.black);
for(let x=0;x<7;x++)for(let z=0;z<7;z++)box('Socket_Pin_Hole',-.146+x*.008,.038,.076+z*.008,.003,.001,.003,materials.metal);
box('Socket_Lever',-.041,.028,.10,.005,.005,.145,materials.metal);
// DRAM slots and older drive connectors at the back left.
for(let i=0;i<3;i++){
 const z=-.115+i*.035;
 box('DRAM_Slot',-.12,.018,z,.265,.026,.022,materials.ram);
 box('DRAM_Channel',-.12,.032,z,.245,.002,.006,materials.black);
 for(const x of [-.26,.02])box('RAM_Latch',x,.018,z,.014,.03,.028,materials.metal);
}
for(let i=0;i<2;i++)box('IDE_Drive_Connector',-.12,.015,-.192+i*.03,.18,.022,.018,materials.black);
box('ATX_Power',-.27,.024,-.065,.033,.04,.11,materials.power);
for(let i=0;i<10;i++)for(let j=0;j<2;j++)box('Power_Opening',-.279+j*.016,.045,-.109+i*.01,.007,.002,.005,materials.black);
// Northbridge heatsink, with neutral Southbridge and ROM chips nearby.
box('Northbridge_Base',.02,.012,.004,.079,.014,.08,materials.chipset);
for(let i=0;i<9;i++)box('Heatsink_Fin',-.016+i*.009,.042,.004,.004,.06,.08,materials.chipset);
box('Southbridge',.145,.010,-.185,.056,.012,.052,materials.black);
box('ROM',.065,.010,-.168,.022,.01,.06,materials.black);
// Four legacy PCI slots and one AGP slot on the right side.
for(let i=0;i<4;i++){
 const x=.11+i*.043;
 box('PCI_Slot',x,.019,-.056,.024,.028,.18,materials.expansion);
 box('PCI_Channel',x,.034,-.056,.006,.002,.159,materials.black);
}
box('AGP_Slot',.071,.018,.12,.024,.027,.13,materials.expansion);
box('AGP_Channel',.071,.033,.12,.006,.002,.112,materials.black);
cylinder('CMOS_Battery',.225,.014,.12,.026,.015,materials.metal);
for(let i=0;i<5;i++){
 const x=-.22+i*.078;
 box('Rear_Peripheral_Connector',x,.023,.208,.06,.04,.04,materials.metal);
 box('Connector_Opening',x,.023,.23,.04,.021,.002,materials.black);
}
for(let i=0;i<8;i++){
 cylinder('Capacitor',-.245+i*.032,.019,.158,.007,.03,materials.metal);
}
for(const x of [-.281,.281])for(const z of [-.22,.22])cylinder('Mounting_Point',x,.006,z,.007,.002,materials.metal);
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
await fs.writeFile('public/models/computer/motherboard-highlighted.glb',Buffer.from(binary));
const bytes=await fs.readFile('public/models/computer/motherboard-highlighted.glb');
if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid GLB');
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
console.log(JSON.stringify({file:'public/models/computer/motherboard-highlighted.glb',bytes:bytes.length,meshes:json.meshes.length,externalBuffers:json.buffers.some(b=>b.uri)}));
