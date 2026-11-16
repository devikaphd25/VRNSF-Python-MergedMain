/** Internal event identifiers shared by the browser and server. */
export const TRUE_FALSE_CHALLENGE_TYPE = "TrueAndFalse";
export const CODE_PATTERN_CHALLENGE_TYPE = "CodePattern";
export const CODE_PATTERN_ACTIVITY_KEY = "code_pattern";
export const LOOP_SORT_CHALLENGE_TYPE = "LoopSort";
export const LOOP_SORT_ACTIVITY_KEY = "loop_sort";
export const FLOWCHART_SHAPE_CHALLENGE_TYPE = "FlowchartShape";
export const FLOWCHART_SHAPE_ACTIVITY_KEY = "flowchart_shape";
export const WHILE_TRACE_CHALLENGE_TYPE = "WhileTrace";
export const WHILE_TRACE_ACTIVITY_KEY = "while_trace";
export const WHILE_PARTS_CHALLENGE_TYPE = "WhileParts";
export const WHILE_PARTS_ACTIVITY_KEY = "while_parts";
export const WHILE_FACTORIAL_CHALLENGE_TYPE = "WhileFactorial";
export const WHILE_FACTORIAL_ACTIVITY_KEY = "while_factorial";
export const STRING_OK_ERROR_CHALLENGE_TYPE = "StringOkError";
export const STRING_OK_ERROR_ACTIVITY_KEY = "string_ok_error";
export const STRING_IN_CHALLENGE_TYPE = "StringIn";
export const STRING_IN_ACTIVITY_KEY = "string_in";
export const STRING_CLEAN_CHALLENGE_TYPE = "StringClean";
export const STRING_CLEAN_ACTIVITY_KEY = "string_clean";

export function isCurriculumChallenge(type?: string): boolean {
  return (
    type === CODE_PATTERN_CHALLENGE_TYPE ||
    type === LOOP_SORT_CHALLENGE_TYPE ||
    type === FLOWCHART_SHAPE_CHALLENGE_TYPE ||
    type === WHILE_TRACE_CHALLENGE_TYPE ||
    type === WHILE_PARTS_CHALLENGE_TYPE ||
    type === WHILE_FACTORIAL_CHALLENGE_TYPE ||
    type === STRING_OK_ERROR_CHALLENGE_TYPE ||
    type === STRING_IN_CHALLENGE_TYPE ||
    type === STRING_CLEAN_CHALLENGE_TYPE
  );
}

export function isQuickChallengeSeries(type?: string): boolean {
  return (
    type === TRUE_FALSE_CHALLENGE_TYPE ||
    type === "database-series" ||
    isCurriculumChallenge(type)
  );
}

export function isRetryableChallenge(type?: string): boolean {
  return type === TRUE_FALSE_CHALLENGE_TYPE || isCurriculumChallenge(type);
}
