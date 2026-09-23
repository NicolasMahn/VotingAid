// How a party voted in one roll-call vote, from the per-member counts in
// data/abstimmungen.json.

// A party whose largest camp is smaller than this voted split.
const UNITED = 0.75;

const STANCES = { yes: 'dafür', no: 'dagegen', abstain: 'enthalten' };

/**
 * `{ stance, yes, no, abstain }` where stance is 'dafür', 'dagegen',
 * 'enthalten' or 'gespalten'; null when the party was not in the Bundestag or
 * none of its members voted.
 */
export function positionOf(counts) {
  if (!counts) return null;
  const { yes = 0, no = 0, abstain = 0 } = counts;
  const present = yes + no + abstain;
  if (!present) return null;
  const [largest, size] = Object.entries({ yes, no, abstain }).reduce((a, b) => (b[1] > a[1] ? b : a));
  return { stance: size / present >= UNITED ? STANCES[largest] : 'gespalten', yes, no, abstain };
}

export function describePosition(position) {
  if (!position) return 'nicht abgestimmt';
  return `${position.stance} (${position.yes} ja, ${position.no} nein, ${position.abstain} Enthaltungen)`;
}
