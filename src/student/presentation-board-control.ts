/** The center-view shortcut belongs to presentation viewing, not classroom activities. */
export function canUsePresentationBoardView(state: Record<string, unknown>): boolean {
  return Boolean(state.isPresentationOpen) && ![
    'isInstructor', 'isPresentationTransitionInProgress', 'isLabActive',
    'isPuzzleActive', 'isCastleActive', 'isDisplayRoomOpen',
    'isQuickChallengeOpen', 'isCodePatternChallengeOpen', 'isChallenge2Open',
  ].some(flag => Boolean(state[flag]));
}
