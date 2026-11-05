import type { DebriefMistakes } from '../../shared/debrief-mistakes';

/** Wrap and paginate every saved wrong answer; never replace long lists with a top-N sample. */
export function debriefMistakePages(review: DebriefMistakes, wrap: (text: string) => string[], linesPerPage: number): string[][] {
  const pages: string[][] = [[]];
  const append = (line: string) => {
    if (pages[pages.length - 1].length >= linesPerPage) pages.push([]);
    pages[pages.length - 1].push(line);
  };
  for (const question of review.questions) {
    const lines = [`Question ${question.questionNumber}`];
    for (const line of lines) append(line);
    if (!question.answers.length) append('No saved wrong answers.');
    for (const answer of question.answers) {
      for (const line of wrap(answer.answer)) append(line);
    }
  }
  return pages;
}

export function drawDebriefMistakes(context: CanvasRenderingContext2D, review: DebriefMistakes | null | undefined, instructor: boolean, pageTick: number): void {
  // The existing student name and Raise Hand controls occupy the upper section.
  const top = instructor ? 65 : 435;
  context.textAlign = 'left';
  context.fillStyle = '#fbbf24';
  context.font = '700 30px Arial';
  context.fillText('COMMON MISTAKES', 44, top);
  context.font = '24px Arial';
  context.fillStyle = '#cbd5e1';
  if (!review) {
    context.fillText('Open a debrief to load saved class responses.', 44, top + 40);
    return;
  }
  const wrap = (text: string) => {
    const lines: string[] = []; let line = '';
    for (const char of text) {
      if (context.measureText(line + char).width > 800) { lines.push(line); line = ''; }
      line += char;
    }
    if (line) lines.push(line);
    return lines;
  };
  const pages = debriefMistakePages(review, wrap, instructor ? 16 : 5);
  const index = pageTick % pages.length;
  context.fillText(`Current session · ${index + 1}/${pages.length}`, 44, top + 36);
  const lines = pages[index];
  if (!review.studentCount) {
    context.fillText('No saved responses for this challenge in this class.', 44, top + 76);
    return;
  }
  lines.forEach((line, i) => {
    context.fillStyle = /^Question \d+$/.test(line) ? '#7dd3fc' : '#f1f5f9';
    context.fillText(line, 44, top + 76 + i * 29);
  });
  if (pages.length > 1) {
    context.font = '20px Arial'; context.fillStyle = '#94a3b8';
    context.fillText('More answers appear automatically every 10 seconds', 44, 690);
  }
}
