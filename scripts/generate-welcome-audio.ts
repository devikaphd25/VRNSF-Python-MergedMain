/** Regenerate the welcome MP3 from the currently published week's enabled tasks. */
import { supabaseAdmin as db } from '../server/services/supabase-admin.service.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const run=promisify(execFile);
const ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg';
const {selectedWeek}=await import('../server/services/content.repository.js');
const courseCode=process.argv[2];
if(!courseCode)throw Error('Pass the course code, for example: generate-welcome-audio.ts CSDP-120');
const {data:course,error:courseError}=await db.from('courses').select('id').eq('course_code',courseCode).single();
if(courseError)throw courseError;
const week=await selectedWeek(course.id);
const {data:tasks,error:taskError}=await db.from('activities').select('activity_type').eq('week_id',week.id);
if(taskError)throw taskError;
const count=(type:string)=>tasks.filter(t=>t.activity_type===type).length;
const phrase=(n:number,label:string)=>`${n} ${label}${n===1?'':'s'}`;
const label=week.title.replace(/^week\s*(\d+)$/i,'Week $1');
const weekName=/^week\s*\d+$/i.test(label)?label:`Week ${week.week_number}, ${label}`;
const transcript=`Welcome aboard the U M E S learning spacecraft. Take your seat, explorer. Our destination is ${weekName}. Mission control has prepared ${phrase(count('video'),'video')}, ${phrase(count('challenge'),'challenge')}, ${phrase(count('debrief'),'debrief')}, and ${phrase(count('game'),'game')} for your journey. Your instructor will guide the mission. Settle in, get ready to discover, and let our learning adventure begin.`;
const dir=await mkdtemp(path.join(tmpdir(),'umes-welcome-'));
try {
 const voice=path.join(dir,'voice.aiff');
 await run('/usr/bin/say',['-v','Samantha','-r','145','-o',voice,transcript]);
 const probe=await run(ffmpeg,['-hide_banner','-i',voice,'-f','null','-']);
 const match=probe.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
 if(!match)throw Error('Unable to measure narration duration');
 const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3])+7;
 const output=path.join(dir,'welcome.mp3');
 // Soft major chord with a slow pulse, faded around the spoken welcome.
 const music='aevalsrc=0.13*(sin(2*PI*130.81*t)+sin(2*PI*164.81*t)+sin(2*PI*196*t))*(0.85+0.15*sin(2*PI*0.15*t)):s=44100';
 await run(ffmpeg,['-y','-hide_banner','-loglevel','error','-i',voice,'-f','lavfi','-i',music,'-filter_complex',`[0:a]adelay=3000:all=1,volume=1.6[v];[1:a]afade=t=in:d=2,afade=t=out:st=${duration-3}:d=3[m];[v][m]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]`,'-map','[a]','-t',String(duration),'-c:a','libmp3lame','-b:a','192k',output]);
 await mkdir('public/audio',{recursive:true});
 await rename(output,'public/audio/umes-week1-welcome.mp3');
 await mkdir('tmp/welcome-audio',{recursive:true});
 await writeFile('tmp/welcome-audio/transcript.txt',transcript);
 console.log(transcript);
}finally{await rm(dir,{recursive:true,force:true});}
