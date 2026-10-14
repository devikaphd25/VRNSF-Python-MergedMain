/** Local, procedural hardware gallery. Database-independent content with room-scoped multiplayer launch. */
import { socket } from '../network/socket';
import { createSystem } from '@iwsdk/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class DisplayRoomSystem extends createSystem({}) {
  private gallery = new THREE.Group();
  private exhibits: THREE.Group[] = [];
  private keys = new Set<string>();
  private active = false;
  private savedPosition = new THREE.Vector3();
  private savedRotation = new THREE.Quaternion();
  private elapsed = 0;
  private turnLatch = false;
  private returnPanel?: THREE.Mesh;
  private returnRay = new THREE.Raycaster();
  private returnPointer = new THREE.Vector2();
  private lastReturnRequest = 0;
  private rightTriggerPressed = false;
  private rightReturnBeam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({color: 0x67e8f9, depthTest: false, toneMapped: false})
  );
  private hud!: HTMLButtonElement;
  private get canReturnClass(): boolean { return (window as any).isInstructor === true; }
  private get rig(): THREE.Object3D { return (this.player as any).object3D ?? this.player; }

  init() {
    this.gallery.position.set(200, 0, 0);
    this.gallery.visible = false;
    this.scene.add(this.gallery);
    this.buildRoom();
    // Explicit mesh picking avoids asynchronous UI-panel loading and ray-distance limits.
    this.renderer.domElement.addEventListener('click', event => {
      if (!this.active || !this.canReturnClass || this.renderer.xr.isPresenting) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.returnPointer.set((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1);
      this.returnRay.setFromCamera(this.returnPointer, this.camera);
      this.pickReturnButton();
    });
    this.rightReturnBeam.visible = false;
    this.rightReturnBeam.frustumCulled = false;
    this.rightReturnBeam.renderOrder = 65002;
    this.scene.add(this.rightReturnBeam);
    socket.on('displayRoomOpened', () => this.open());
    socket.on('displayRoomClosed', () => this.close());
    // Restore the classroom transform before another activity positions its UI.
    const exitEvents = new Set(['returnAllToClassroomNow', 'returnToClassroom', 'classEnded',
      'presentationContentChanged', 'quickChallengeStarted', 'challenge2Started', 'gameChanged', 'launchPythonPuzzle']);
    socket.prependAny((event: string) => { if (exitEvents.has(event)) this.close(); });
    window.addEventListener('keydown', e => {
      if (!this.active) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') this.requestClose();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    this.hud = document.createElement('button');
    this.hud.textContent = 'Return to class · Esc | Move: arrows / WASD · Look: Q / E';
    this.hud.style.cssText = 'display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;padding:14px 22px;background:#082437;color:#baf5ff;border:1px solid #3bd7ef;border-radius:12px;cursor:pointer';
    this.hud.onclick = () => this.requestClose();
    document.body.appendChild(this.hud);
  }

  private box(w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.position.set(x,y,z); this.gallery.add(mesh); return mesh;
  }

  private label(text:string,w:number,h:number,x:number,y:number,z:number) {
    const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=160;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#071a2b';ctx.fillRect(0,0,1024,160);
    ctx.strokeStyle='#47d9ef';ctx.lineWidth=6;ctx.strokeRect(3,3,1018,154);
    ctx.fillStyle='#d6faff';ctx.font='bold 46px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,80);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    mesh.position.set(x,y,z);this.gallery.add(mesh);return mesh;
  }

  private buildRoom() {
    const metal=new THREE.MeshStandardMaterial({color:'#101d30',metalness:.65,roughness:.4});
    const floor=new THREE.MeshStandardMaterial({color:'#111a29',metalness:.55,roughness:.32});
    const glow=new THREE.MeshBasicMaterial({color:'#48dcff'});
    this.box(16,.18,16,0,-.1,0,floor);
    this.box(16,.2,16,0,5.5,0,metal);
    this.box(.2,5.5,16,-8,2.75,0,metal);this.box(.2,5.5,16,8,2.75,0,metal);
    this.box(16,5.5,.2,0,2.75,8,metal);this.box(16,5.5,.2,0,2.75,-8,metal);
    // Space-window image sits inside a deep frame, behind the floating exhibits.
    const tex=new THREE.TextureLoader().load('/textures/nasa/nasa-earth-galaxy-window-v3.png');tex.colorSpace=THREE.SRGBColorSpace;
    const windowMesh=new THREE.Mesh(new THREE.PlaneGeometry(14,3.7),new THREE.MeshBasicMaterial({map:tex}));
    windowMesh.position.set(0,3,-7.85);this.gallery.add(windowMesh);
    for (const x of [-7,-3.5,0,3.5,7]) this.box(.16,4,.2,x,3,-7.65,metal);
    for (const y of [1,5]) this.box(14.5,.055,.07,0,y,-7.6,glow);
    for (const x of [-7.5,7.5]) {
      this.box(.045,.025,15,x,.01,0,glow);this.box(.06,.04,15,x,5.35,0,glow);
      for (const z of [-6,-2,2,6]) this.box(.2,4.8,.15,x,2.6,z,metal);
    }
    const ceilingRing=new THREE.Mesh(new THREE.TorusGeometry(4.7,.035,8,80),glow);ceilingRing.rotation.x=Math.PI/2;ceilingRing.position.y=5.3;this.gallery.add(ceilingRing);
    this.gallery.add(new THREE.HemisphereLight(0xaacfff,0x071020,2));
    const key=new THREE.PointLight(0xd1e6ff,65,18,2);key.position.set(0,4,1);this.gallery.add(key);
    const loader=new GLTFLoader();
    const models=[{name:'CPU',file:'cpu',x:-4,z:-2,size:1.45},{name:'MOTHERBOARD',file:'motherboard-highlighted',x:0,z:-3,size:2.5},{name:'RAM',file:'ram',x:4,z:-2,size:2.0}];
    for(const item of models) {
      const base=new THREE.Mesh(new THREE.CylinderGeometry(1.3,1.4,.22,48),metal);base.position.set(item.x,.12,item.z);this.gallery.add(base);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.18,.045,8,64),glow);ring.rotation.x=Math.PI/2;ring.position.set(item.x,.25,item.z);this.gallery.add(ring);
      const disc=new THREE.Mesh(new THREE.CircleGeometry(.94,48),new THREE.MeshBasicMaterial({color:'#43ccff',transparent:true,opacity:.6}));disc.rotation.x=-Math.PI/2;disc.position.set(item.x,.24,item.z);this.gallery.add(disc);
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(.5,.95,1.65,32,1,true),new THREE.MeshBasicMaterial({color:'#3bdcff',transparent:true,opacity:.055,side:THREE.DoubleSide,depthWrite:false}));beam.position.set(item.x,1.08,item.z);this.gallery.add(beam);
      const light=new THREE.PointLight(0x48dfff,12,4,2);light.position.set(item.x,.5,item.z);this.gallery.add(light);
      const pivot=new THREE.Group();pivot.position.set(item.x,2,item.z);this.gallery.add(pivot);this.exhibits.push(pivot);
      loader.load(`/models/computer/${item.file}.glb`, gltf=>{
        const model=gltf.scene;
        const bounds=new THREE.Box3().setFromObject(model);const size=bounds.getSize(new THREE.Vector3());
        model.position.sub(bounds.getCenter(new THREE.Vector3()));
        const mount=new THREE.Group();mount.add(model);mount.scale.setScalar(item.size/Math.max(size.x,size.y,size.z));
        // All three source models lie flat with their component side facing +Y.
        mount.rotation.x=-Math.PI/2;
        // Turn CPU and DIMM in their own plane so their lettering is upright.
        if (item.file === 'ram' || item.file === 'cpu') model.rotation.y = Math.PI;
        pivot.add(mount);
      },undefined,error=>{console.error('[Display Room] Model failed',item.file,error);this.label(`${item.name} unavailable`,2,.3,item.x,2,item.z);});
      this.label(item.name,2,.32,item.x,3.75,item.z);
    }
    this.label('DISPLAY ROOM · COMPUTER HARDWARE',5,.5,0,4.7,-7.4);
    this.label('Move: left stick · Turn: right stick',5,.35,0,.75,-6.7);
  }

  private open() {
    if(this.active) return;
    this.rightTriggerPressed = true; // Release the launch trigger before returning.
    (window as any).presentationSystem?.exitPresentationMode?.();
    (window as any).setInstructorDebriefChoiceOpen?.(false);
    (window as any).setInstructorDashboardOpen?.(false);
    (window as any).isDisplayRoomOpen = true;
    this.savedPosition.copy(this.rig.position);this.savedRotation.copy(this.rig.quaternion);
    this.active=true;this.gallery.visible=true;this.rig.position.set(200,0,4.5);this.rig.quaternion.identity();
    if (this.canReturnClass) {
      if (!this.returnPanel) this.createReturnButton();
      this.returnPanel!.visible = true;
      this.returnPanel!.updateWorldMatrix(true, false);
    }
    this.hud.textContent = 'Return ALL to class · Esc / B | Move: arrows / WASD · Look: Q / E';
    this.hud.style.display=this.canReturnClass && !this.renderer.xr.isPresenting?'block':'none';
  }
  private createReturnButton() {
    const canvas = document.createElement('canvas');
    canvas.width=1024; canvas.height=256;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#991b1b'; ctx.strokeStyle='#fca5a5'; ctx.lineWidth=8;
    ctx.beginPath(); ctx.roundRect(6,6,1012,244,32); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#ffffff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='bold 64px Arial'; ctx.fillText('RETURN TO CLASS',512,105);
    ctx.font='32px Arial'; ctx.fillText('Return all students · Point and press trigger',512,181);
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    this.returnPanel=new THREE.Mesh(new THREE.PlaneGeometry(3,.75),
      new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide,toneMapped:false}));
    this.returnPanel.name='DisplayRoomReturnAllButton';
    // Mounted inside the front wall, above the exhibits and visible from entry.
    this.returnPanel.position.set(4.9,4.35,-7.45);
    this.returnPanel.frustumCulled=false;
    this.gallery.add(this.returnPanel);
  }

  private pickReturnButton() {
    if (!this.returnPanel?.visible || !this.active || !this.canReturnClass) return;
    this.returnPanel.updateWorldMatrix(true,false);
    if (this.returnRay.intersectObject(this.returnPanel).length) this.requestClose();
  }

  /** Use the SDK ray space, which includes the player's room teleport and turning. */
  private updateRightReturnRay() {
    const session = this.renderer.xr.getSession();
    const input = session ? [...session.inputSources].find(source => source.handedness === 'right') : undefined;
    const pressed = Boolean(input?.gamepad?.buttons[0]?.pressed);
    const justPressed = pressed && !this.rightTriggerPressed;
    this.rightTriggerPressed = pressed;
    this.rightReturnBeam.visible = false;
    if (!this.canReturnClass || !input || !this.returnPanel?.visible) return;
    const raySpace = this.world.player.raySpaces.right;
    raySpace.updateWorldMatrix(true, false);
    this.returnRay.ray.origin.setFromMatrixPosition(raySpace.matrixWorld);
    this.returnRay.ray.direction.set(0,0,-1).transformDirection(raySpace.matrixWorld);
    this.returnRay.near = 0;
    this.returnRay.far = 30; // Covers the full room from every permitted walking position.
    this.returnPanel.updateWorldMatrix(true, false);
    const hit = this.returnRay.intersectObject(this.returnPanel)[0];
    const material = this.returnPanel.material as THREE.MeshBasicMaterial;
    material.color.setHex(hit ? 0xffd4c4 : 0xffffff);
    if (!hit) return;
    // Show a complete beam to this distant wall button, independent of the SDK's short UI ray.
    const positions = this.rightReturnBeam.geometry.getAttribute('position') as THREE.BufferAttribute;
    const origin = this.returnRay.ray.origin;
    positions.setXYZ(0, origin.x, origin.y, origin.z);
    positions.setXYZ(1, hit.point.x, hit.point.y, hit.point.z);
    positions.needsUpdate = true;
    this.rightReturnBeam.visible = true;
    if (justPressed) this.requestClose();
  }

  private requestClose() {
    // Wait for the authorized server broadcast so everyone returns together.
    if (!this.active || !this.canReturnClass) return;
    if (Date.now()-this.lastReturnRequest < 700) return;
    this.lastReturnRequest=Date.now();
    socket.emit('instructorDisplayRoom', { open: false });
  }
  private close() {
    if(!this.active) return;
    (window as any).isDisplayRoomOpen = false;
    this.active=false;this.gallery.visible=false;this.keys.clear();this.hud.style.display='none';
    if (this.returnPanel) this.returnPanel.visible = false;
    this.rightReturnBeam.visible = false;
    this.rightTriggerPressed = false;
    this.rig.position.copy(this.savedPosition);this.rig.quaternion.copy(this.savedRotation);
    // Display Room hides the launcher directly each frame. Reapply the normal
    // classroom visibility, controller attachment, and pointer interaction on exit.
    this.rig.updateMatrixWorld(true);
    (window as any).refreshInstructorMenuButton?.();
  }
  update(delta:number) {
    if(!this.active) return;
    this.updateRightReturnRay();
    this.hud.style.display = this.canReturnClass && !this.renderer.xr.isPresenting ? 'block' : 'none';
    // Suppress the ordinary dashboard launcher throughout this room.
    const dashboard = (window as any).instructorMenuButtonObject;
    if (dashboard) { dashboard.visible = false; dashboard.pointerEvents = 'none'; }
    const dt=Math.min(delta,.05);this.elapsed+=dt;
    this.exhibits.forEach((object,i)=>{object.rotation.y=this.elapsed*.22+i*.25;object.position.y=2+Math.sin(this.elapsed*.8+i)*.09;});
    let x=Number(this.keys.has('arrowright')||this.keys.has('d'))-Number(this.keys.has('arrowleft')||this.keys.has('a'));
    let z=Number(this.keys.has('arrowdown')||this.keys.has('s'))-Number(this.keys.has('arrowup')||this.keys.has('w'));
    this.rig.rotation.y+=(Number(this.keys.has('q'))-Number(this.keys.has('e')))*dt*1.4;
    let turn=0;
    for(const source of this.renderer.xr.getSession()?.inputSources??[]) {
      const gamepad=source.gamepad;if(!gamepad) continue;
      const axes=gamepad.axes;const ax=axes.length>=4?axes[2]:axes[0]??0;const ay=axes.length>=4?axes[3]:axes[1]??0;
      if(source.handedness==='left'){x+=Math.abs(ax)>.15?ax:0;z+=Math.abs(ay)>.15?ay:0;}
      if(source.handedness==='right'){turn=ax;if(this.canReturnClass && gamepad.buttons[5]?.pressed){this.requestClose();return;}}
    }
    if(Math.abs(turn)>.65&&!this.turnLatch){this.rig.rotation.y-=Math.sign(turn)*Math.PI/6;this.turnLatch=true;}
    if(Math.abs(turn)<.3)this.turnLatch=false;
    const eye=this.renderer.xr.isPresenting?this.renderer.xr.getCamera():this.camera;
    const forward=new THREE.Vector3();eye.getWorldDirection(forward);forward.y=0;forward.normalize();
    const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
    const motion=right.multiplyScalar(x).addScaledVector(forward,-z);if(motion.length()>1)motion.normalize();
    const next=this.rig.position.clone().addScaledVector(motion,dt*1.8);
    next.x=THREE.MathUtils.clamp(next.x,193,207);next.z=THREE.MathUtils.clamp(next.z,-7,7);
    // Keep visitors outside the three display platforms.
    if(!this.exhibits.some(p=>Math.hypot(next.x-200-p.position.x,next.z-p.position.z)<1.55))this.rig.position.copy(next);
  }
}
