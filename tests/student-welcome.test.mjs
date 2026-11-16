import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function setup({blocked=false}={}){
 const handlers={}, gestures={}, storage=new Map(), audio=[];
 class Audio {constructor(src){this.src=src;this.played=0;this.paused=false;audio.push(this);} async play(){this.played++;if(blocked)throw new Error('NotAllowedError');} pause(){this.paused=true;}}
 const code=ts.transpile(readFileSync('src/audio/student-welcome.ts','utf8').replace("import { socket } from '../network/socket-client';",''),{target:ts.ScriptTarget.ES2022});
 vm.runInNewContext(code,{socket:{on:(n,f)=>handlers[n]=f},window:{addEventListener:(n,f)=>gestures[n]=f},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},Audio});
 return {handlers,audio,gestures,storage,allowAudio:()=>{blocked=false;}};
}
test('normal welcome stops on an activity and never replays in same session',()=>{
 const {handlers:h,audio:a}=setup();const data={roomId:'r',userId:'u'};
 h.studentWelcome(data);assert.match(a[0].src,/week1/);
 h.challenge2Started();assert.equal(a[0].paused,true);
 h.studentWelcome(data);assert.equal(a.length,1);
 h.studentWelcome({...data,roomId:'new'});assert.equal(a.length,2);
});
test('late greeting survives initial replay but stops on next activity',()=>{
 const {handlers:h,audio:a}=setup();h.studentWelcome({roomId:'r',userId:'u',activityEvent:'presentationContentChanged'});
 assert.match(a[0].src,/late/);h.presentationContentChanged();assert.equal(a[0].paused,false);
 h.quickChallengeStarted();assert.equal(a[0].paused,true);
});
test('display room interrupts welcome and supports the late-join greeting',()=>{
 const {handlers:h,audio:a}=setup();
 h.studentWelcome({roomId:'gallery',userId:'early'});h.displayRoomOpened();
 assert.equal(a[0].paused,true);
 h.studentWelcome({roomId:'gallery',userId:'late',activityEvent:'displayRoomOpened'});
 h.displayRoomOpened();assert.equal(a[1].paused,false);
 h.presentationContentChanged();assert.equal(a[1].paused,true);
});

test('blocked welcome retries on a headset gesture and records only successful playback',async()=>{
 const {handlers:h,audio:a,gestures:g,storage,allowAudio}=setup({blocked:true});
 h.studentWelcome({roomId:'xr',userId:'student'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(storage.has('umes-welcome:xr:student'),false);
 allowAudio();g['welcome-audio-gesture']();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(a[0].played,2);
 assert.equal(storage.get('umes-welcome:xr:student'),'played');
});
test('an activity cancels blocked welcome so later headset gestures cannot replay it',async()=>{
 const {handlers:h,audio:a,gestures:g,allowAudio}=setup({blocked:true});
 h.studentWelcome({roomId:'xr',userId:'student'});
 await new Promise(resolve=>setImmediate(resolve));
 h.quickChallengeStarted();allowAudio();g['welcome-audio-gesture']();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(a[0].played,1);assert.equal(a[0].paused,true);
 h.studentWelcome({roomId:'xr',userId:'student'});assert.equal(a.length,1);
});
