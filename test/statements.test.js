import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closestDocuments, closestPassage, toBits } from '../js/statements.js';
import { buildStatementsRequest } from '../js/analysis.js';

test('bits are packed the same way as in the Python build script', () => {
  const vector = [0.3, -0.1, 0.2, 0.0, -0.5, 0.9, 0.1, -0.2, 0.4, 0.4, -0.4, 0.1, -0.3, 0.2, 0.7, -0.6];
  const python = execFileSync('python3', [
    '-c',
    `import sys, json; sys.path.insert(0, 'scripts'); from build_statements import to_bits; print(list(to_bits(${JSON.stringify(vector)})))`,
  ]);
  assert.deepEqual([...toBits(vector)], JSON.parse(python.toString()));
});

test('the closest documents are found per party by Hamming distance', () => {
  // Two parties, eight dimensions: one byte of bits per document.
  const meta = { dimensions: 8, count: 3, parties: ['afd', 'spd'] };
  const index = Uint8Array.from([1, 0b11110000, 1, 0b00001111, 0, 0b00001111]);
  const query = [1, 1, 1, 1, -1, -1, -1, -1];
  const closest = closestDocuments({ meta, index }, query, 1);
  assert.deepEqual(closest, { spd: [0], afd: [2] });
});

test('the passage closest to the query is picked within a document', () => {
  const meta = { passageDimensions: 2 };
  const vectors = Int8Array.from([127, 0, 0, 127]);
  const doc = { passages: ['über Steuern', 'über Mieten'], vectors: Buffer.from(vectors.buffer).toString('base64') };
  assert.equal(closestPassage({ meta }, doc, [0.1, 0.9, 0.5]).text, 'über Mieten');
});

test('statements tell Jev who said what, and parties without any are skipped', () => {
  const doc = { id: 's1', kind: 'rede', speaker: 'Lars Klingbeil', role: 'Bundesminister der Finanzen', date: '2025-09-23', title: 'Haushalt' };
  const { state, questions } = buildStatementsRequest('Haushalt', 'Mehr investieren.', { spd: [{ doc, passage: 'Wir investieren.' }] });
  assert.equal(state.statements.SPD[0].speaker, 'Lars Klingbeil, Bundesminister der Finanzen');
  assert.equal(state.statements.SPD[0].kind, 'Rede im Bundestag');
  assert.deepEqual(Object.keys(questions), ['spd_match', 'spd_covered', 'spd_source']);
});
