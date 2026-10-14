import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const scene=new THREE.Scene();scene.background=new THREE.Color('#111c2a');
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.01,20);
camera.position.set(.62,.8,.72);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.4;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd9eeff,0x52604a,3));
for(const [x,y,z,power] of [[1,2,1,5],[-1,1,-1,3]]){
 const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(x,y,z);scene.add(light);
}
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.025,0);controls.enableDamping=true;controls.minDistance=.28;controls.maxDistance=3;
const requested = new URLSearchParams(location.search).get('model');
const model = requested === 'motherboard-highlighted' || requested === 'motherboard' || requested === 'ram' ? requested : 'cpu';
const title = model === 'motherboard-highlighted' ? 'Motherboard — main parts' : model === 'ram' ? 'RAM memory stick' : model === 'motherboard' ? 'Motherboard' : 'CPU model';
const modelUrl = `/models/computer/${model}.glb`;
document.title = title;
document.querySelector('h1')!.textContent = title;
(document.querySelector('a') as HTMLAnchorElement).href = modelUrl;
new GLTFLoader().load(modelUrl,gltf=>scene.add(gltf.scene),undefined,()=>{document.getElementById('error')!.textContent='Could not load model.';});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});

if (model === 'motherboard-highlighted') {
 const legend=document.createElement('div');
 legend.style.cssText='position:absolute;right:24px;top:24px;background:#111c2ae8;padding:18px;border-radius:8px;line-height:1.8;font:16px Arial';
 for(const [label,color] of [['CPU socket','#ffa63d'],['RAM slots','#329cff'],['Northbridge heatsink','#32d6c4'],['PCI / AGP slots','#b391ff'],['Power connector','#ffdc55']]) {
  const row=document.createElement('div');row.textContent='● '+label;row.style.color=color;legend.appendChild(row);
 }
 document.body.appendChild(legend);
}
