export type EnvironmentSequenceResult =
  | { readonly _tag: "SequenceAccepted"; readonly sequence: number }
  | { readonly _tag: "SequenceIgnored"; readonly sequence: number }
  | {
      readonly _tag: "ResnapshotRequired";
      readonly currentSequence: number;
      readonly receivedSequence: number;
      readonly reason: "SequenceGap";
    };

export function advanceEnvironmentSequence(
  currentSequence: number,
  receivedSequence: number,
): EnvironmentSequenceResult {
  if (receivedSequence <= currentSequence) {
    return { _tag: "SequenceIgnored", sequence: currentSequence };
  }

  if (receivedSequence === currentSequence + 1) {
    return { _tag: "SequenceAccepted", sequence: receivedSequence };
  }

  return {
    _tag: "ResnapshotRequired",
    currentSequence,
    reason: "SequenceGap",
    receivedSequence,
  };
}
