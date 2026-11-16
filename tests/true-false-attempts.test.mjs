import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {isQuickChallengeSeries,isRetryableChallenge} from '../shared/challenge-types.ts';
import {gradeChallengeAnswer} from '../server/services/grade-challenge-answer.ts';
import {TRUE_FALSE_MAX_ATTEMPTS} from '../shared/true-false-settings.ts';

function handlers() {
  const source=ts.createSourceFile('server.ts',fs.readFileSync('server.ts','utf8'),ts.ScriptTarget.Latest,true);
  const callbacks=new Map();
  function visit(node) {
    if(ts.isCallExpression(node)&&node.expression.getText(source)==='socket.on'&&ts.isStringLiteral(node.arguments[0])) {
      callbacks.set(node.arguments[0].text,node.arguments[1].getText(source));
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  const challenge={id:'quiz-1',challengeType:'TrueAndFalse',startedAt:Date.now(),durationSeconds:300,
    questions:[{options:['True','False'],correctIndex:0}],studentProgress:new Map(),responseParticipants:new Map()};
  const emitted=[],saved=[];
  const socket={id:'student-1',connected:true,data:{roomId:'room-1',role:'student',participantId:'p1'},
    emit:(event,payload)=>emitted.push({event,payload})};
  const context=vm.createContext({socket,isQuickChallengeSeries,isRetryableChallenge,gradeChallengeAnswer,TRUE_FALSE_MAX_ATTEMPTS,TRUE_FALSE_CHALLENGE_TYPE:'TrueAndFalse',
    activeQuickChallenges:new Map([['room-1',challenge]]),students:{'student-1':{}},challengeRetryPending:false,
    saveChallengeResponses:async()=>{saved.push(structuredClone(challenge.studentProgress.get(socket.id)));},
    notifyInstructorStudentProgress(){},publishQuickChallengeReview(){},finishFivePartsIfEveryoneDone(){},
    getFivePartsScore:progress=>progress.answers.filter(answer=>answer.correct).length,console});
  const compile=name=>vm.runInContext(ts.transpile(`(${callbacks.get(name)})`,{target:ts.ScriptTarget.ES2022}),context);
  return {challenge,socket,emitted,saved,answer:compile('quickChallengeAnswer'),retry:compile('quickChallengeRetry')};
}

test('server preserves completed retry results and enforces three total submitted attempts',async()=>{
  const f=handlers();
  for(let attempt=1;attempt<=TRUE_FALSE_MAX_ATTEMPTS;attempt++) {
    const progress=f.challenge.studentProgress.get(f.socket.id);
    f.answer({quizId:f.challenge.id,answers:[0],attemptStartedAt:progress?.attemptStartedAt});
    const result=f.emitted.at(-1).payload;
    assert.equal(result.attemptCount,attempt);
    assert.equal(result.retriesRemaining,TRUE_FALSE_MAX_ATTEMPTS-attempt);
    let reply;
    await f.retry({quizId:f.challenge.id},value=>reply=value);
    if(attempt<TRUE_FALSE_MAX_ATTEMPTS) {
      assert.equal(reply.success,true);
      const next=f.challenge.studentProgress.get(f.socket.id);
      assert.equal(next.attemptCount,attempt,'retry must preserve the completed attempt count');
      assert.equal(next.completed,false);
      assert.equal(f.saved.at(-1).completed,true,'save must happen before clearing the result');
      assert.equal(f.saved.at(-1).attemptCount,attempt);
    } else {
      assert.equal(reply.success,false);
      assert.match(reply.message,/three attempts/);
      assert.equal(f.challenge.studentProgress.get(f.socket.id).completed,true);
    }
  }
});

test('server rejects a forged fourth submission without changing the saved answers',()=>{
  const f=handlers();
  f.challenge.studentProgress.set(f.socket.id,{completed:false,answers:[],attemptCount:3});
  f.answer({quizId:f.challenge.id,answers:[0]});
  assert.equal(f.challenge.studentProgress.get(f.socket.id).answers.length,0);
  assert.equal(f.emitted.at(-1).payload.retriesRemaining,0);
});

test('student retry availability uses the same limit and respects the shared timer',()=>{
  const source=ts.createSourceFile('student.ts',fs.readFileSync('src/systems/true-false-challenge.system.ts','utf8'),ts.ScriptTarget.Latest,true);
  const declaration=source.statements.find(ts.isClassDeclaration);
  const method=declaration.members.find(m=>m.name?.getText(source)==='canRetryFiveParts').getText(source);
  const context=vm.createContext({TRUE_FALSE_MAX_ATTEMPTS});
  vm.runInContext(ts.transpile(`class Retry { ${method} }; globalThis.Retry=Retry;`,{target:ts.ScriptTarget.ES2022}),context);
  const retry=new context.Retry();
  Object.assign(retry,{isFivePartsChallenge:()=>true,challengeClosed:false,timeExpired:false,fivePartsAttempts:2});
  assert.equal(retry.canRetryFiveParts(),true);
  retry.fivePartsAttempts=3;
  assert.equal(retry.canRetryFiveParts(),false);
  retry.fivePartsAttempts=1;retry.timeExpired=true;
  assert.equal(retry.canRetryFiveParts(),false);
});
