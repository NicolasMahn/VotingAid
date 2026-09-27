import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// scripts/hand_votes.py reads how each fraction voted from what the chair said.
function read(said) {
  const python = `
import sys, json; sys.path.insert(0, 'scripts')
from hand_votes import VOTE, ACCEPTED, read_vote
vote = VOTE.search(${JSON.stringify(said)})
print(json.dumps(read_vote(vote.group('body'), vote.group('result'), vote.group('outcome') in ACCEPTED)))`;
  return JSON.parse(execFileSync('python3', ['-c', python]).toString());
}

test('fractions named in the answers to the chair', () => {
  const said =
    'Wer stimmt für den Antrag? – Das ist Bündnis 90/Die Grünen. Wer stimmt dagegen? – Das sind AfD, CDU/CSU und SPD. ' +
    'Wer enthält sich? – Das ist die Fraktion Die Linke. Damit ist der Antrag abgelehnt.';
  assert.deepEqual(read(said), { gruene: 'yes', afd: 'no', union: 'no', spd: 'no', linke: 'abstain' });
});

test('groups: the coalition, and everyone else', () => {
  const said =
    'Wer stimmt für diese Beschlussempfehlung? – Das sind die Unionsfraktion und die SPD-Fraktion. ' +
    'Wer stimmt dagegen? – Das sind alle übrigen Fraktionen. Dann ist die Beschlussempfehlung angenommen.';
  assert.deepEqual(read(said), { union: 'yes', spd: 'yes', afd: 'no', gruene: 'no', linke: 'no' });
});

test('fractions named only in the result', () => {
  const said =
    'Wer stimmt dafür? – Wer stimmt dagegen? – Wer enthält sich? – Damit ist der Entschließungsantrag abgelehnt ' +
    'mit den Stimmen von CDU/CSU, SPD und AfD bei Zustimmung von Bündnis 90/Die Grünen und Die Linke.';
  assert.deepEqual(read(said), { union: 'no', spd: 'no', afd: 'no', gruene: 'yes', linke: 'yes' });
});

test('a unanimous vote says nothing about differences and is left out', () => {
  assert.equal(read('Wer stimmt dafür? – Alle. Damit ist die Beschlussempfehlung angenommen.'), null);
});
