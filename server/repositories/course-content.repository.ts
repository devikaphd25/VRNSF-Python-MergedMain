/** The database decides which week and ordered tasks appear in the dashboard. */
import { serial } from "../utils/serial-work-queue.js";
import { supabaseAdmin as db } from '../database/supabase-client.js';
import { CODE_PATTERN_ACTIVITY_KEY, LOOP_SORT_ACTIVITY_KEY, FLOWCHART_SHAPE_ACTIVITY_KEY, WHILE_TRACE_ACTIVITY_KEY, WHILE_PARTS_ACTIVITY_KEY, WHILE_FACTORIAL_ACTIVITY_KEY, STRING_OK_ERROR_ACTIVITY_KEY, STRING_IN_ACTIVITY_KEY, STRING_CLEAN_ACTIVITY_KEY } from "../../shared/challenge-types.js";
import {
  CSDP99_W1D1_CHALLENGE1_QUESTIONS,
  CSDP99_W1D1_CHALLENGE1_TITLE,
} from "../../shared/csdp99-w1d1-challenge1.js";
import {
  CSDP99_W1D1_CHALLENGE2_QUESTIONS,
  CSDP99_W1D1_CHALLENGE2_TITLE,
} from "../../shared/csdp99-w1d1-challenge2.js";
import {
  CSDP99_W1D1_CHALLENGE3_QUESTIONS,
  CSDP99_W1D1_CHALLENGE3_TITLE,
} from "../../shared/csdp99-w1d1-challenge3.js";
import {
  CSDP99_W1D2_CHALLENGE1_QUESTIONS,
  CSDP99_W1D2_CHALLENGE1_TITLE,
} from "../../shared/csdp99-w1d2-challenge1.js";
import {
  CSDP99_W1D2_CHALLENGE2_QUESTIONS,
  CSDP99_W1D2_CHALLENGE2_TITLE,
} from "../../shared/csdp99-w1d2-challenge2.js";
import {
  CSDP99_W1D2_CHALLENGE3_QUESTIONS,
  CSDP99_W1D2_CHALLENGE3_TITLE,
} from "../../shared/csdp99-w1d2-challenge3.js";
import {
  CSDP120_W13D2_CHALLENGE1_QUESTIONS,
  CSDP120_W13D2_CHALLENGE1_TITLE,
} from "../../shared/csdp120-w13d2-challenge1.js";
import {
  CSDP120_W13D2_CHALLENGE2_QUESTIONS,
  CSDP120_W13D2_CHALLENGE2_TITLE,
} from "../../shared/csdp120-w13d2-challenge2.js";
import {
  CSDP120_W13D2_CHALLENGE3_QUESTIONS,
  CSDP120_W13D2_CHALLENGE3_TITLE,
} from "../../shared/csdp120-w13d2-challenge3.js";
/** Codes are strings so values such as 012345 keep their leading zero. */
export async function courseByAccessCode(accessCode: unknown) {
    if (typeof accessCode !== 'string' || !/^[0-9]{6}$/.test(accessCode)) {
        throw new Error('Enter a 6-digit course code.');
    }
    const { data: course, error } = await db.from('courses')
        .select('id,course_code,title').eq('access_code', accessCode).maybeSingle();
    if (error) {
        if (error.code === '42703' || error.code === 'PGRST204') {
            throw new Error('Course code database setup is incomplete. Ask the administrator to check the database.');
        }
        throw new Error('Could not check the course code. Please try again.');
    }
    if (!course) throw new Error('Course code not found. Check the six digits.');
    return course;
}

/** Validate the code without starting a class or admitting waiting students. */
export async function courseOutline(accessCode: unknown) {
    const course = await courseByAccessCode(accessCode);
    const { data: weeks, error } = await db.from('weeks').select('id,week_number,title')
        .eq('course_id', course.id).order('week_number');
    if (error) throw new Error('Could not load course weeks.');
    const { data: days, error: dayError } = await db.from('days').select('id,week_id,day_number,title')
        .in('week_id', (weeks ?? []).map(w => w.id)).order('day_number');
    if (dayError) throw new Error('Course day database setup is incomplete. Ask the administrator to check the database.');
    return { course, weeks: (weeks ?? []).map(w => ({ ...w, days: (days ?? []).filter(d => d.week_id === w.id) })) };
}

export async function selectedCourseDay(courseId: number, weekId: unknown, dayId: unknown) {
    if (!Number.isSafeInteger(weekId) || Number(weekId) < 1 || !Number.isSafeInteger(dayId) || Number(dayId) < 1)
        throw new Error('Select a week and day before starting the class.');
    const { data: week, error } = await db.from('weeks').select('*').eq('id', weekId).eq('course_id', courseId).maybeSingle();
    if (error || !week) throw new Error('The selected week does not belong to this course.');
    const { data: day, error: dayError } = await db.from('days').select('*').eq('id', dayId).eq('week_id', week.id).maybeSingle();
    if (dayError || !day) throw new Error('The selected day is unavailable for this week.');
    return { week, day };
}

export async function selectedWeek(courseId: number) {
    const { data: course, error: ce } = await db.from('courses')
        .select('id,course_code,title').eq('id', courseId).single();
    if (ce) throw new Error('The selected course is unavailable.');
    const weekNumber = Number(process.env.WEEK_NUMBER || 1);
    const { data: week, error } = await db.from('weeks').select('*').eq('course_id', course.id)
        .eq('week_number', weekNumber).single();
    if (error) throw new Error(`Week ${weekNumber} has not been added to ${course.course_code}.`);
    return { ...week, course };
}

/** Content belongs to the class session, never to a global default course. */
export async function weekForSession(roomId: string) {
    const { data: session, error: se } = await db.from('class_sessions')
        .select('week_id,day_id').eq('id', roomId).is('ended_at', null).maybeSingle();
    if (se || !session) throw new Error('This classroom is no longer active.');
    const { data: week, error: we } = await db.from('weeks').select('*').eq('id', session.week_id).single();
    if (we) throw new Error('The classroom week is unavailable.');
    const { data: course, error: ce } = await db.from('courses')
        .select('id,course_code,title').eq('id', week.course_id).single();
    if (ce) throw new Error('The classroom course is unavailable.');
    const { data: day, error: de } = await db.from('days').select('*').eq('id', session.day_id).eq('week_id', week.id).maybeSingle();
    if (de || !day) throw new Error('This classroom has no selected day. Check the database setup and start a new class.');
    return { ...week, course, day };
}

export async function resolveMedia(filePath: string | null) {
    if (!filePath?.startsWith('supabase://'))
        return filePath;
    const path = filePath.slice(11), split = path.indexOf('/');
    if (split < 1)
        throw Error('Invalid Storage path');
    const { data, error } = await db.storage.from(path.slice(0, split)).createSignedUrl(path.slice(split + 1), 86400);
    if (error)
        throw error;
    return data.signedUrl;
}
function courseCodeKey(courseCode: string) {
    return String(courseCode).replace(/-/g, "").toUpperCase();
}

async function ensureCsdp99Challenge(
    week: Awaited<ReturnType<typeof weekForSession>>,
    dayNumber: number,
    activityKey: string,
    title: string,
    questions: Array<{
        prompt: string;
        options: string[];
        correctIndex?: number;
        correctIndices?: number[];
    }>,
    courseCode = "CSDP99",
    weekNumber = 1,
) {
    if (courseCodeKey(week.course.course_code) !== courseCode) return;
    if (week.week_number !== weekNumber || week.day.day_number !== dayNumber) return;
    const { data: existing, error: existingError } = await db
        .from("activities")
        .select("id")
        .eq("day_id", week.day.id)
        .eq("activity_key", activityKey)
        .maybeSingle();
    if (existingError) throw existingError;
    let activityId = existing?.id as number | undefined;
    if (!activityId) {
        const { data: last } = await db
            .from("activities")
            .select("activity_order")
            .eq("day_id", week.day.id)
            .order("activity_order", { ascending: false })
            .limit(1)
            .maybeSingle();
        const { data: inserted, error } = await db
            .from("activities")
            .insert({
                week_id: week.id,
                day_id: week.day.id,
                title,
                activity_type: "challenge",
                activity_key: activityKey,
                activity_order: (last?.activity_order ?? 0) + 1,
            })
            .select("id")
            .single();
        if (error) throw error;
        activityId = inserted.id;
    }
    const rows = questions.map((question, index) => ({
        activity_id: activityId,
        question_order: index + 1,
        question_type: "multiple_choice",
        question_text: question.prompt,
        options: question.options,
        correct_answer: question.correctIndices
            ? { choice_indices: question.correctIndices }
            : { choice_index: question.correctIndex },
    }));
    const { error } = await db
        .from("challenge_questions")
        .upsert(rows, { onConflict: "activity_id,question_order" });
    if (error) throw error;
}

export async function instructorContent(roomId: string) {
    const week = await weekForSession(roomId);
    try {
        await ensureCsdp99Challenge(
            week,
            1,
            CODE_PATTERN_ACTIVITY_KEY,
            CSDP99_W1D1_CHALLENGE1_TITLE,
            CSDP99_W1D1_CHALLENGE1_QUESTIONS,
        );
        await ensureCsdp99Challenge(
            week,
            1,
            LOOP_SORT_ACTIVITY_KEY,
            CSDP99_W1D1_CHALLENGE2_TITLE,
            CSDP99_W1D1_CHALLENGE2_QUESTIONS,
        );
        await ensureCsdp99Challenge(
            week,
            1,
            FLOWCHART_SHAPE_ACTIVITY_KEY,
            CSDP99_W1D1_CHALLENGE3_TITLE,
            CSDP99_W1D1_CHALLENGE3_QUESTIONS,
        );
        await ensureCsdp99Challenge(
            week,
            2,
            WHILE_TRACE_ACTIVITY_KEY,
            CSDP99_W1D2_CHALLENGE1_TITLE,
            CSDP99_W1D2_CHALLENGE1_QUESTIONS,
        );
        await ensureCsdp99Challenge(
            week,
            2,
            WHILE_PARTS_ACTIVITY_KEY,
            CSDP99_W1D2_CHALLENGE2_TITLE,
            CSDP99_W1D2_CHALLENGE2_QUESTIONS,
        );
        await ensureCsdp99Challenge(
            week,
            2,
            WHILE_FACTORIAL_ACTIVITY_KEY,
            CSDP99_W1D2_CHALLENGE3_TITLE,
            CSDP99_W1D2_CHALLENGE3_QUESTIONS,
        );
        await ensureCsdp99Challenge(
            week,
            2,
            STRING_OK_ERROR_ACTIVITY_KEY,
            CSDP120_W13D2_CHALLENGE1_TITLE,
            CSDP120_W13D2_CHALLENGE1_QUESTIONS,
            "CSDP120",
            13,
        );
        await ensureCsdp99Challenge(
            week,
            2,
            STRING_IN_ACTIVITY_KEY,
            CSDP120_W13D2_CHALLENGE2_TITLE,
            CSDP120_W13D2_CHALLENGE2_QUESTIONS,
            "CSDP120",
            13,
        );
        await ensureCsdp99Challenge(
            week,
            2,
            STRING_CLEAN_ACTIVITY_KEY,
            CSDP120_W13D2_CHALLENGE3_TITLE,
            CSDP120_W13D2_CHALLENGE3_QUESTIONS,
            "CSDP120",
            13,
        );
    } catch (error) {
        console.error("[Course content] Could not add curriculum challenges", error);
    }
    const { data, error } = await db.from('activities').select('*').eq('week_id', week.id).eq('day_id', week.day.id).order('activity_order');
    if (error)
        throw error;
    const activities = await Promise.all((data ?? []).map(async (a) => ({
        activityId: a.id, activityOrder: a.activity_order, activityType: ({ video: 'presentation', debrief: 'briefing' } as Record<string, string>)[a.activity_type] ?? a.activity_type,
        activityKey: a.activity_key, title: a.title, description: '', assetPath: await resolveMedia(a.file_path),
    })));
    return { dayId: week.day.id, dayNumber: week.day.day_number, dayTitle: week.day.title, weekId: week.id, weekNumber: week.week_number, weekTitle: week.title, courseCode: week.course.course_code, courseTitle: week.course.title,
        activities, videos: activities.filter(a => a.activityType === 'presentation') };
}
export async function activityForSession(roomId: string, key?: string, activityId?: number) {
    const { data: session, error } = await db.from('class_sessions').select('week_id,day_id').eq('id', roomId).is('ended_at', null).single();
    if (error || !session?.day_id) throw new Error('This classroom has no selected day.');
    let query = db.from('activities').select('*').eq('week_id', session.week_id).eq('day_id', session.day_id);
    query = activityId ? query.eq('id', activityId) : query.eq('activity_key', key);
    const { data, error: ae } = await query.single();
    if (ae || !data) throw new Error('Activity is unavailable for the selected day.');
    return data;
}
export async function selectSessionActivity(roomId: string, activityId: number | null) {
    return serial(`session-activity:${roomId}`, async () => {
        const { error } = await db.from('class_sessions').update({ active_activity_id: activityId }).eq('id', roomId);
        if (error) throw error;
    });
}
