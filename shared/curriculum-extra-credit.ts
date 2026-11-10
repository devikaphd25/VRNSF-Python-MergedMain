import {
  WHILE_FACTORIAL_CHALLENGE_TYPE,
  WHILE_TRACE_CHALLENGE_TYPE,
} from "./challenge-types.js";
import { CSDP99_W1D2_CHALLENGE1_EXTRA_CREDIT } from "./csdp99-w1d2-challenge1.js";
import { CSDP99_W1D2_CHALLENGE3_EXTRA_CREDIT } from "./csdp99-w1d2-challenge3.js";

export type CurriculumExtraCreditQuestion = {
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
};

export function getCurriculumExtraCredit(
  challengeType?: string
): CurriculumExtraCreditQuestion[] {
  if (challengeType === WHILE_TRACE_CHALLENGE_TYPE) {
    return CSDP99_W1D2_CHALLENGE1_EXTRA_CREDIT;
  }
  if (challengeType === WHILE_FACTORIAL_CHALLENGE_TYPE) {
    return CSDP99_W1D2_CHALLENGE3_EXTRA_CREDIT;
  }
  return [];
}
