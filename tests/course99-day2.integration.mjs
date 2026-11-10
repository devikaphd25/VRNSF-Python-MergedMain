/** Opt-in Supabase round trip for the adapted Day 2 branch, with isolated fixtures and cleanup. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import { loadDatabaseChallengeQuestions } from '../build/server/repositories/challenge-content.repository.js';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false},realtime:{transport:WebSocket}});
const value=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data;};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn){for(let i=0;i<100;i++){const result=await fn();if(result)return result;await pause(150);}throw Error('Timed out waiting for saved responses');}
function event(socket,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out: '+name)),20000);socket.once(name,data=>{clearTimeout(timer);resolve(data);});});}
const tag='day2-branch-test-'+Date.now(),accessCode=String(randomInt(100000,1000000));
const sockets=[],users=[],activities=[];let course,week,day,session,server,log='';
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const base=`http://127.0.0.1:${port}`;
async function post(path,body){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
async function connect(user,participant){const socket=io(base,{transports:['websocket'],autoConnect:false});sockets.push(socket);const ready=event(socket,'connect');socket.connect();await ready;const registered=event(socket,'classroomClientRegistered');socket.emit('registerClassroomClient',{userId:user.id,username:user.username,roomId:session.room_id,participantId:participant?.participant_id});await registered;return socket;}
const ack=(socket,name,data)=>new Promise((resolve,reject)=>socket.timeout(20000).emit(name,data,(error,reply)=>error?reject(error):resolve(reply)));
try{
 course=await value(db.from('courses').insert({course_code:tag,title:'Temporary Day 2 integration verification',access_code:accessCode}).select().single());
 week=await value(db.from('weeks').insert({course_id:course.id,week_number:1,title:'Test week'}).select().single());
 day=await value(db.from('days').insert({week_id:week.id,day_number:2,title:'Test day'}).select().single());
 for(const [index,id]of [180,181,182].entries()){
  const source=await value(db.from('activities').select('*').eq('id',id).single());
  const row=await value(db.from('activities').insert({week_id:week.id,day_id:day.id,activity_type:'challenge',activity_key:source.activity_key,title:'Database '+source.title,activity_order:index+1}).select().single());activities.push(row);
  const rows=(await value(db.from('challenge_questions').select('*').eq('activity_id',id).order('question_order'))).filter(q=>!q.options?.archived);
  if(id!==181)assert.equal((await loadDatabaseChallengeQuestions(source,true)).length,8);
  row.questions=await value(db.from('challenge_questions').insert(rows.map(q=>({activity_id:row.id,question_order:q.question_order,question_type:q.question_type,question_text:q.question_text,options:q.options,correct_answer:q.correct_answer}))).select('*'));
  if(id===181){const q=row.questions[0];q.options={...q.options,completion_return_seconds:0.1};q.correct_answer={category:'output'};await value(db.from('challenge_questions').update({options:q.options,correct_answer:q.correct_answer}).eq('id',q.id));}
  else{const q=row.questions.find(q=>q.options.extra_credit);q.question_text='Database-only extra-credit prompt';q.options={...q.options,choices:['Database bonus A','Database bonus B','Database bonus C'],presentation:{...q.options.presentation,prompt:q.question_text}};q.correct_answer={choice_index:2};await value(db.from('challenge_questions').update({question_text:q.question_text,options:q.options,correct_answer:q.correct_answer}).eq('id',q.id));}
 }
 server=spawn(process.execPath,['server/start-production.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',data=>log+=data);server.stderr.on('data',data=>log+=data);
 await poll(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}});
 const teacherUser=(await post('device-login',{deviceId:tag+'-teacher',displayName:'Day 2 Test Instructor',role:'instructor'})).user;users.push(teacherUser.id);
 const studentUser=(await post('device-login',{deviceId:tag+'-student',displayName:'Day 2 Test Student',role:'student'})).user;users.push(studentUser.id);
 session=await post('class-sessions',{instructorId:teacherUser.id,accessCode,weekId:week.id,dayId:day.id});
 const participant=await post('class-sessions/join',{deviceId:tag+'-student'});
 const teacher=await connect(teacherUser); let pupil=await connect(studentUser,participant);
 for(const [activity,type]of [[activities[0],'WhileTrace'],[activities[2],'WhileFactorial']]){
  const started=event(pupil,'quickChallengeStarted'),monitor=event(teacher,'quickChallengeStartedForInstructor');
  teacher.emit('instructorQuickChallenge',{activityId:activity.id,challengeType:type,durationSeconds:180});const launch=await started,teacherData=await monitor;
  assert.equal(launch.questions.length,5);assert.equal(launch.extraCreditQuestions.length,3);assert.equal(teacherData.extraCreditStats.length,3);
  assert.equal(launch.extraCreditQuestions[0].question,'Database-only extra-credit prompt');assert.equal(launch.extraCreditQuestions[0].options[0],'Database bonus A');
  for(const q of [...launch.questions,...launch.extraCreditQuestions]){assert.equal(q.correctIndex,undefined);assert.equal(q.correct_answer,undefined);}
  assert.equal((await ack(pupil,'quickChallengeExtraCreditStart',{quizId:launch.id})).success,false,'Bonus cannot start before a perfect main score');
  const main=activity.questions.filter(q=>!q.options.extra_credit).sort((a,b)=>a.question_order-b.question_order),extra=activity.questions.filter(q=>q.options.extra_credit).sort((a,b)=>a.question_order-b.question_order);
  const mainResult=event(pupil,'quickChallengeResult');pupil.emit('quickChallengeAnswer',{quizId:launch.id,answers:main.map(q=>q.correct_answer.choice_index)});assert.equal((await mainResult).correctCount,5);
  let begun=await ack(pupil,'quickChallengeExtraCreditStart',{quizId:launch.id});assert.equal(begun.success,true);
  const correct=extra.map(q=>q.correct_answer.choice_index),wrong=[(correct[0]+1)%extra[0].options.choices.length,...correct.slice(1)];
  const submitted=await ack(pupil,'quickChallengeExtraCredit',{quizId:launch.id,attemptStartedAt:begun.attemptStartedAt,answers:wrong,correctCount:999});assert.equal(submitted.success,true);assert.equal(submitted.correctCount,2);
  const duplicate=await ack(pupil,'quickChallengeExtraCredit',{quizId:launch.id,attemptStartedAt:begun.attemptStartedAt,answers:correct});assert.equal(duplicate.correctCount,2,'Duplicate submission must not rewrite an attempt');
  let saved=await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id',activity.id));assert.equal(saved.length,2);assert.equal(saved.find(r=>Number(r.score)===7).challenge_responses.length,8);
  pupil.disconnect(); pupil=await connect(studentUser,participant);
  const replay=event(pupil,'quickChallengeStarted'), restored=event(pupil,'quickChallengeExtraCreditRestored'); pupil.emit('classroomSceneReady');
  assert.equal((await replay).id,launch.id);assert.equal((await restored).correctCount,2);
  const oldToken=begun.attemptStartedAt;begun=await ack(pupil,'quickChallengeExtraCreditStart',{quizId:launch.id});assert.equal(begun.success,true);
  assert.equal((await ack(pupil,'quickChallengeExtraCredit',{quizId:launch.id,attemptStartedAt:oldToken,answers:correct})).success,false,'Stale submissions are rejected');
  const retry=await ack(pupil,'quickChallengeExtraCredit',{quizId:launch.id,attemptStartedAt:begun.attemptStartedAt,answers:correct});assert.equal(retry.correctCount,3);
  saved=await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id',activity.id));assert.deepEqual(saved.map(r=>Number(r.score)).sort((a,b)=>a-b),[5,7,8]);
  begun=await ack(pupil,'quickChallengeExtraCreditStart',{quizId:launch.id});assert.equal(begun.success,true);
  const drafted=event(teacher,'quickChallengeStudentAnswered');pupil.emit('quickChallengeDraft',{quizId:launch.id,extraCredit:true,attemptStartedAt:begun.attemptStartedAt,answers:[correct[0],null,null]});assert.equal((await drafted).extraCreditStats[0].correctCount,1);
  const ended=event(pupil,'quickChallengeEnded');teacher.emit('stopQuickChallenge',{quizId:launch.id});await ended;
  await poll(async()=>{const rows=await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id',activity.id));const stopped=rows.find(r=>r.status==='stopped');if(!stopped)return false;assert.equal(stopped.challenge_responses.filter(r=>r.student_answer!==null).length,6);return true;});
  console.log('PASS '+type+': database bonus content, server grading, duplicate/stale rejection, retries, main history, and stopped partial responses');
 }
 const activity=activities[1],started=event(pupil,'challenge2Started'),monitor=event(teacher,'challenge2StartedForInstructor');teacher.emit('instructorStartChallenge2',{activityId:activity.id,durationSeconds:60});const launch=await started,teacherData=await monitor;
 assert.equal(launch.items.length,5);assert.equal(teacherData.questionStats.length,5);assert.equal(launch.items[0].category,'output','Device classification follows fixture database answer');
 for(const [index,item]of launch.items.entries()){
  if(index===0){const wrong=event(pupil,'challenge2ItemResult');pupil.emit('challenge2ItemAnswer',{challengeId:launch.id,itemId:item.id,selectedCategory:'input'});assert.equal((await wrong).correct,false);}
  const result=event(pupil,'challenge2ItemResult');pupil.emit('challenge2ItemAnswer',{challengeId:launch.id,itemId:item.id,selectedCategory:item.category});assert.equal((await result).correct,true);
 }
 await poll(async()=>{const rows=await value(db.from('challenge_results').select('*,challenge_responses(*)').eq('activity_id',activity.id));if(!rows[0] || rows[0].status!=='completed' || rows[0].challenge_responses.length!==5)return false;assert.equal(rows[0].challenge_responses.length,5);assert.ok(rows[0].challenge_responses.every(r=>r.is_correct));return true;});
 await pause(200);const returned=event(pupil,'challenge2Ended');pupil.emit('challenge2ReturnToClass',{challengeId:launch.id});assert.equal((await returned).reason,'completed');
 console.log('PASS device classification: five database devices, wrong attempt and five saved responses, instructor statistics, completed return');
 await ack(teacher,'endClass',{});
} catch(error){console.error(log.slice(-5000));throw error;}
finally{
 for(const socket of sockets)socket.disconnect();if(server){server.kill();await pause(300);}
 const ids=activities.map(a=>a.id);
 if(ids.length){const results=await value(db.from('challenge_results').select('id').in('activity_id',ids));if(results.length){await value(db.from('challenge_responses').delete().in('challenge_result_id',results.map(r=>r.id)));await value(db.from('challenge_results').delete().in('id',results.map(r=>r.id)));}}
 if(session){await value(db.from('participants').delete().eq('session_id',session.room_id));await value(db.from('class_sessions').delete().eq('id',session.room_id));}
 if(ids.length){await value(db.from('challenge_questions').delete().in('activity_id',ids));await value(db.from('activities').delete().in('id',ids));}
 if(day)await value(db.from('days').delete().eq('id',day.id));if(week)await value(db.from('weeks').delete().eq('id',week.id));if(users.length)await value(db.from('users').delete().in('id',users));if(course)await value(db.from('courses').delete().eq('id',course.id));
 console.log('Removed only temporary Day 2 test records.');
}
