import { LOOP_DROP_CATEGORIES, type LoopDragItem, type LoopDragRound, type LoopDropCategory } from '../../shared/loop-drag-drop.js';

/** Read-only adapter: no embedded lesson catalog, seed writes or client answer keys. */
export function databaseDragDropLesson(allRows: any[]) {
  const questions = allRows.filter(row => !row.options?.archived);
  if (!questions.length) throw Error('Drag/drop questions are missing in Supabase.');
  const loop = questions[0].options?.format === 'loop_parts';
  const rounds: LoopDragRound[] = [];
  const ids = new Set<string>();
  const items = questions.map(row => {
    const item = row.options?.item;
    if (row.question_type !== 'drag_drop' || !item?.id || typeof item.name !== 'string' || ids.has(item.id)) throw Error('Invalid Supabase drag/drop item.');
    ids.add(item.id);
    if (!loop) {
      if (!['input','output','both','storage'].includes(row.correct_answer?.category)) throw Error('Invalid device answer category.');
      return { id:item.id, name:item.name, modelPath:item.model_path, imagePath:item.image_path, modelRotationY:item.model_rotation_y, feedback:item.feedback, category:row.correct_answer.category };
    }
    const round = row.options.round;
    if (row.options.format !== 'loop_parts' || ![1,2].includes(item.part) || round?.part !== item.part ||
      typeof round.prompt !== 'string' || !round.prompt.trim() || typeof round.instructions !== 'string' ||
      !Array.isArray(round.boxes) || !round.boxes.length || round.boxes.length > 4 ||
      round.boxes.some((box: any) => !LOOP_DROP_CATEGORIES.includes(box.category) || typeof box.label !== 'string' || !box.label.trim()) ||
      new Set(round.boxes.map((box: any) => box.category)).size !== round.boxes.length ||
      !round.boxes.some((box: any) => box.category === row.correct_answer?.category) ||
      (item.code_lines !== undefined && (!Array.isArray(item.code_lines) || item.code_lines.some((line: any) => typeof line !== 'string'))) ||
      (round.code_lines !== undefined && (!Array.isArray(round.code_lines) || round.code_lines.some((line: any) => typeof line !== 'string')))) throw Error(`Invalid Supabase loop drag/drop question ${row.id}.`);
    const parsed: LoopDragRound = { part:item.part, prompt:round.prompt, instructions:round.instructions,
      codeLines:round.code_lines, boxes:round.boxes.map((box: any) => ({category:box.category as LoopDropCategory,label:box.label})) };
    const prior = rounds.find(entry => entry.part === parsed.part);
    if (prior && JSON.stringify(prior) !== JSON.stringify(parsed)) throw Error('Conflicting Supabase round instructions.');
    if (!prior) rounds.push(parsed);
    return { id:item.id, name:item.name, part:item.part,
      codeLines:item.code_lines, displayText:item.display_text } satisfies LoopDragItem;
  });
  if (loop && (!rounds.some(round => round.part === 1) || !rounds.some(round => round.part === 2))) throw Error('Both loop rounds are required in Supabase.');
  return { questions, items, rounds, format: loop ? 'loop_parts' : 'devices' };
}
