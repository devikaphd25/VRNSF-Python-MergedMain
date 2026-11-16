import type { DebriefMistakes } from '../../shared/debrief-mistakes';

/** Compact rows used for pagination and accessible text representations. */
export function debriefMistakePages(review: DebriefMistakes, wrap: (text: string) => string[], linesPerPage: number): string[][] {
  const pages: string[][] = [[]];
  for (const question of review.questions) {
    const label = question.shortLabel || question.question || `Question ${question.questionNumber}`;
    const counts = Number.isInteger(question.incorrectStudentCount) && Number.isInteger(question.answeredStudentCount)
      ? `${question.incorrectStudentCount} of ${question.answeredStudentCount}` : 'Counts unavailable';
    for (const line of wrap(`Q${question.questionNumber} — ${label}: ${counts}`)) {
      if (pages[pages.length - 1].length >= linesPerPage) pages.push([]);
      pages[pages.length - 1].push(line);
    }
  }
  return pages;
}

export function drawDebriefMistakes(context: CanvasRenderingContext2D, review: DebriefMistakes | null | undefined, instructor: boolean, pageTick: number): void {
  // A single compact Raise Hand/name row leaves the lower panel for six rows.
  const top = instructor ? 65 : 240;
  context.textAlign = 'left';
  context.fillStyle = '#e0f2fe';
  context.font = '700 32px Arial';
  context.fillText('QUESTIONS TO REVIEW', 44, top);
  context.font = '22px Arial';
  context.fillStyle = '#94a3b8';
  context.fillText('Current session · First-attempt answers', 44, top + 34);
  if (!review) {
    context.fillText('Loading saved responses…', 44, top + 82);
    return;
  }
  if (!review.studentCount) {
    context.fillText('No saved responses for this challenge yet.', 44, top + 82);
    return;
  }
  if (review.questions.some(question => !Number.isInteger(question.incorrectStudentCount) || !Number.isInteger(question.answeredStudentCount))) {
    context.fillStyle = '#fbbf24';
    context.fillText('Updated counts are not loaded yet.', 44, top + 82);
    context.fillStyle = '#cbd5e1';
    context.fillText('Restart the backend, refresh, and reopen this debrief.', 44, top + 118);
    return;
  }
  const perPage = instructor ? 10 : 6;
  const pageCount = Math.max(1, Math.ceil(review.questions.length / perPage));
  const page = pageTick % pageCount;
  const questions = review.questions.slice(page * perPage, (page + 1) * perPage);
  const highest = Math.max(0, ...review.questions.map(question => question.incorrectStudentCount));
  context.font = '600 22px Arial';
  context.fillStyle = '#cbd5e1';
  context.fillText('QUESTION', 44, top + 80);
  context.textAlign = 'right';
  context.fillText('INCORRECT / ANSWERED', 850, top + 80);
  questions.forEach((question, index) => {
    const y = top + 124 + index * 46;
    const highlight = highest > 0 && question.incorrectStudentCount === highest;
    context.fillStyle = highlight ? 'rgba(251, 146, 60, 0.14)' : 'rgba(148, 163, 184, 0.07)';
    context.fillRect(32, y - 29, 834, 41);
    context.fillStyle = highlight ? '#fb923c' : '#e2e8f0';
    context.font = `${highlight ? '700' : '500'} 24px Arial`;
    context.textAlign = 'left';
    let label = `Q${question.questionNumber} — ${question.shortLabel || question.question}`;
    while (label.length && context.measureText(label).width > 540) label = label.slice(0, -1);
    const fullLabel = `Q${question.questionNumber} — ${question.shortLabel || question.question}`;
    if (label !== fullLabel) label = label.slice(0, -1) + '…';
    context.fillText(label, 44, y);
    context.textAlign = 'right';
    context.fillText(question.answeredStudentCount ? `${question.incorrectStudentCount} of ${question.answeredStudentCount}` : 'No answers', 850, y);
  });
  context.textAlign = 'left';
  context.font = '20px Arial';
  context.fillStyle = '#94a3b8';
  context.fillText('Orange highlights the question(s) needing most review.', 44, 664);
  if (pageCount > 1) context.fillText(`Page ${page + 1}/${pageCount} · Changes every 10 seconds`, 44, 691);
}
