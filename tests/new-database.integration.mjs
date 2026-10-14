/** Opt-in live test. Creates an isolated course and removes only its own rows.
 * Run: node --env-file=.env.server tests/new-database.integration.mjs
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomInt} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {io} from 'socket.io-client';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false},realtime:{transport:WebSocket}});
const code=`migration-test-${Date.now()}`,port=3012,base=`http://127.0.0.1:${port}`;
const accessCode=String(randomInt(100000,1000000));
let course,week,server,log='',users=[],sockets=[],session;
const value=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn){for(let i=0;i<80;i++){const v=await fn();if(v)return v;await pause(250);}throw Error('Timed out waiting for database result');}
const event=(socket,name)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Timed out: ${name}`)),15000);socket.once(name,data=>{clearTimeout(timer);resolve(data);});});
async function post(path,body){const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.ok(r.ok,JSON.stringify(j));return j;}
async function device(role,index){const r=await post('device-login',{deviceId:`${code}-${index}`,displayName:`Migration Test ${index}`,role});users.push(r.user.id);return r.user;}
async function connect(user,join){const sock=io(base,{transports:['websocket'],autoConnect:false});sockets.push(sock);const ready=event(sock,'connect');sock.connect();await ready;const registered=event(sock,'classroomClientRegistered');sock.emit('registerClassroomClient',{userId:user.id,username:user.username,roomId:session.room_id,participantId:join?.participant_id});await registered;return sock;}
try{
 course=await value(db.from('courses').insert({course_code:code,title:'Temporary integration test',access_code:accessCode}).select().single());
 week=await value(db.from('weeks').insert({course_id:course.id,week_number:1,title:'Test Week'}).select().single());
 const source=await value(db.from('activities').select('*').eq('week_id',1).order('activity_order'));
 const activities=[];for(const a of source){const copy=await value(db.from('activities').insert({week_id:week.id,title:a.title,activity_type:a.activity_type,activity_order:a.activity_order,file_path:a.file_path,activity_key:a.activity_key}).select().single());activities.push(copy);if(a.activity_type==='challenge'){const qs=await value(db.from('challenge_questions').select('*').eq('activity_id',a.id));await value(db.from('challenge_questions').insert(qs.map(({id,activity_id,...q})=>({...q,activity_id:copy.id}))));}}
 server=spawn(process.execPath,['--import','tsx','server.ts'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
 await poll(async()=>{try{return (await fetch(base+'/api/instructor-content')).status===400;}catch{return false;}});
 const instructor=await device('instructor',1);
 const invalid=await fetch(base+'/api/class-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instructorId:instructor.id,accessCode:'wrong'})});
 assert.equal(invalid.status,400);
 session=await post('class-sessions',{instructorId:instructor.id,accessCode});
 assert.equal(session.courseCode,code);
 const content=await (await fetch(base+'/api/instructor-content?sessionId='+session.room_id)).json();assert.equal(content.activities.length,19);assert.equal(content.videos.length,11);
 assert.equal(content.courseCode,code);
 assert.deepEqual(content.activities.map(a=>a.activityOrder),Array.from({length:19},(_,i)=>i+1));
 const image=content.activities.find(a=>a.activityType==='briefing');assert.equal((await fetch(image.assetPath,{method:'HEAD'})).status,200);
 console.log('PASS course code selection, invalid code rejection, session-specific content');
 const student=await device('student',2),second=await device('student',3);
 const [join,join2]=await Promise.all([post('class-sessions/join',{deviceId:`${code}-2`}),post('class-sessions/join',{deviceId:`${code}-3`})]);
 assert.notEqual(join.seat,join2.seat);assert.equal((await post('class-sessions/join',{deviceId:`${code}-2`})).participant_id,join.participant_id);
 const teacher=await connect(instructor),pupil=await connect(student,join),pupil2=await connect(second,join2);
 console.log('PASS join: concurrent unique seats, persistent device and participant');
 const tf=activities.find(a=>a.activity_key==='true_false');
 const qs=await value(db.from('challenge_questions').select('*').eq('activity_id',tf.id).order('question_order'));
 let started=event(pupil,'quickChallengeStarted');teacher.emit('instructorQuickChallenge',{activityId:tf.id,challengeType:'five-parts'});const launch=await started;assert.equal(launch.questions.length,5);
 pupil.emit('quickChallengeAnswer',{quizId:launch.id,answers:qs.map(q=>q.correct_answer.choice_index)});
 await poll(async()=>{const r=await value(db.from('challenge_results').select('*').eq('activity_id',tf.id).eq('participant_id',join.participant_id));return r[0]?.status==='completed';});
 teacher.emit('stopQuickChallenge',{quizId:launch.id});
 await poll(async()=>{const r=await value(db.from('challenge_results').select('*').eq('activity_id',tf.id));return r.length===2&&r.some(r=>r.status==='stopped');});
 let results=await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id',tf.id));assert.equal(results.length,2);assert.equal(results.find(r=>r.status==='completed').score,5);assert.equal(results.find(r=>r.status==='stopped').challenge_responses.filter(a=>a.student_answer===null).length,5);
 console.log('PASS Challenge 1: completion + stop, unanswered rows, no duplicate attempts');
 const multi=activities.find(a=>a.activity_key==='multiple_choice');
 started=event(pupil,'quickChallengeStarted');teacher.emit('instructorQuickChallenge',{activityId:multi.id,challengeType:'database-series'});const m=await started;assert.equal(m.questions.length,2);
 const late=await device('student',4),lateJoin=await post('class-sessions/join',{deviceId:`${code}-4`}),lateSock=await connect(late,lateJoin);
 const replay=event(lateSock,'quickChallengeStarted');lateSock.emit('classroomSceneReady');assert.equal((await replay).id,m.id);
 teacher.emit('stopQuickChallenge',{quizId:m.id});await poll(async()=>{const rows=await value(db.from('challenge_results').select('*').eq('activity_id',multi.id));return rows.length===3;});
 console.log('PASS Challenge 3: database questions, late join replay and stop saving');
 const drag=activities.find(a=>a.activity_key==='drag_drop');started=event(pupil,'challenge2Started');teacher.emit('instructorStartChallenge2',{activityId:drag.id});const d=await started;assert.equal(d.items.length,5);
 for(const item of d.items){const reply=event(pupil,'challenge2ItemResult');pupil.emit('challenge2ItemAnswer',{challengeId:d.id,itemId:item.id,selectedCategory:item.category});assert.equal((await reply).correct,true);}
 await poll(async()=>{const rows=await value(db.from('challenge_results').select('*').eq('activity_id',drag.id).eq('participant_id',join.participant_id));return rows[0]?.status==='completed';});
 teacher.emit('instructorStopChallenge2',{challengeId:d.id});await poll(async()=>{const rows=await value(db.from('challenge_results').select('*').eq('activity_id',drag.id));return rows.length===3;});
 console.log('PASS Challenge 2: database items, grading, completion and stop saving');
 const game=activities.find(a=>a.activity_key==='python-puzzle');started=event(pupil,'launchPythonPuzzle');teacher.emit('instructorLaunchPythonPuzzle',{activityId:game.id});await started;
 pupil.emit('studentJoinLab',{});pupil2.emit('studentJoinLab',{});await pause(200);
 pupil.emit('gameResponse',{itemKey:'python-code',answer:{code:'print(1)'},correct:true});
 pupil.emit('labCompleted',{result:{score:100,completedCards:7,totalCards:7,correctAnswers:7,wrongAnswers:0,durationSeconds:5,accuracy:100}});
 await poll(async()=>{const r=await value(db.from('game_results').select('*').eq('activity_id',game.id).eq('participant_id',join.participant_id));return r[0]?.status==='completed';});
 pupil2.emit('labProgressUpdated',{score:20,completedCards:2,totalCards:7,correctAnswers:2,wrongAnswers:1,durationSeconds:5});await pause(100);
 teacher.emit('instructorReturnAllToClass');
 await poll(async()=>{const r=await value(db.from('game_results').select('*').eq('activity_id',game.id));return r.some(r=>r.status==='stopped');});
 const games=await value(db.from('game_results').select('*,game_responses(*)').eq('activity_id',game.id));assert.ok(games.find(g=>g.status==='completed').game_responses.some(r=>r.item_key==='python-code'));
 console.log('PASS puzzle: game summary, submissions and instructor stop');
 const display=activities.find(a=>a.activity_key==='display-room');started=event(pupil,'displayRoomOpened');teacher.emit('instructorDisplayRoom',{activityId:display.id,open:true});await started;
 let active=await value(db.from('class_sessions').select('*').eq('id',session.room_id).single());assert.equal(active.active_activity_id,display.id);
 started=event(pupil,'displayRoomClosed');teacher.emit('instructorDisplayRoom',{open:false});await started;
 await new Promise((resolve,reject)=>teacher.emit('endClass',{},r=>r.success?resolve():reject(Error(r.message))));
 active=await value(db.from('class_sessions').select('*').eq('id',session.room_id).single());assert.ok(active.ended_at);assert.equal(active.active_activity_id,null);
 console.log('PASS display room, return home and end class persisted');
}catch(error){console.error(log.slice(-7000));throw error;}
finally{
 for(const socket of sockets)socket.disconnect();
 if(server){server.kill();await pause(300);}
 if(week){
  const acts=await value(db.from('activities').select('id').eq('week_id',week.id));const ids=acts.map(a=>a.id);
  for(const kind of ['challenge','game']){const rs=ids.length?await value(db.from(`${kind}_results`).select('id').in('activity_id',ids)):[];if(rs.length){await value(db.from(`${kind}_responses`).delete().in(`${kind}_result_id`,rs.map(r=>r.id)));await value(db.from(`${kind}_results`).delete().in('id',rs.map(r=>r.id)));}}
  const sessions=await value(db.from('class_sessions').select('id').eq('week_id',week.id));if(sessions.length)await value(db.from('participants').delete().in('session_id',sessions.map(r=>r.id)));
  await value(db.from('class_sessions').delete().eq('week_id',week.id));
  if(ids.length)await value(db.from('challenge_questions').delete().in('activity_id',ids));
  await value(db.from('activities').delete().eq('week_id',week.id));await value(db.from('weeks').delete().eq('id',week.id));
 }
 if(users.length)await value(db.from('users').delete().in('id',users));
 if(course)await value(db.from('courses').delete().eq('id',course.id));
 console.log('Temporary test records removed');
}
