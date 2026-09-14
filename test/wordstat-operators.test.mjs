import test from 'node:test';
import assert from 'node:assert/strict';
import { toExactForm, toQuotedForm } from '../src/wordstat-operators.mjs';

test('quoted form normalizes whitespace and existing outer operators', () => {
  assert.equal(toQuotedForm('  мягкий   топливный бак  '), '"мягкий топливный бак"');
  assert.equal(toQuotedForm('"!мягкий !топливный !бак"'), '"мягкий топливный бак"');
  assert.equal(toQuotedForm('DLE130G T-Motor'), '"DLE130G T-Motor"');
  assert.equal(toQuotedForm('[мягкий топливный бак]'), '"мягкий топливный бак"');
  assert.equal(toQuotedForm('(мягкий|гибкий) бак'), '"мягкий гибкий бак"');
  assert.equal(toQuotedForm('+для !БПЛА'), '"для БПЛА"');
});

test('exact form preserves Unicode and hyphenated tokens', () => {
  assert.equal(toExactForm('мягкий топливный бак'), '"!мягкий !топливный !бак"');
  assert.equal(toExactForm('"!DLE130G !T-Motor"'), '"!DLE130G !T-Motor"');
  assert.equal(toExactForm('[мягкий топливный бак]'), '"!мягкий !топливный !бак"');
  assert.equal(toExactForm('(мягкий|гибкий) бак'), '"!мягкий !гибкий !бак"');
  assert.equal(toExactForm('+для !БПЛА'), '"!для !БПЛА"');
});

test('operator forms reject empty input', () => {
  assert.throws(() => toQuotedForm('  '), /must not be empty/u);
  assert.throws(() => toExactForm(''), /must not be empty/u);
});
