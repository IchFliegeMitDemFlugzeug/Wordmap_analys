import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuery } from '../src/scoring.mjs';

const assertNotEligible = (result) => {
  assert.notEqual(result.relevanceClass, 'core');
  assert.notEqual(result.relevanceClass, 'adjacent');
  assert.equal(result.recursiveEligible, false);
  assert.equal(result.deepEligible, false);
};

test('an untrusted root overlap cannot promote semantic drift', () => {
  assertNotEligible(classifyQuery('крышка топливного бака экскаватора', { rootSeed: 'крышка топливного бака' }));
  assertNotEligible(classifyQuery('вентиляция топливного бака опель', { rootSeed: 'вентиляция топливного бака' }));
  const association = classifyQuery('крышка топливного бака каталог', { rootSeed: 'крышка топливного бака', relationType: 'ASSOCIATION' });
  assert.equal(association.recursiveEligible, false);
  assertNotEligible(classifyQuery('мягкий бак для воды', { rootSeed: 'мягкий топливный бак' }));
  assertNotEligible(classifyQuery('flexible water tank', { rootSeed: 'flexible fuel tank' }));
});

test('flexible fuel tanks are the target product without a UAV word', () => {
  for (const query of ['мягкий топливный бак', 'гибкий топливный бак', 'резиновый топливный бак', 'flexible fuel tank', 'fuel bladder']) {
    assert.equal(classifyQuery(query, { rootSeed: query }).relevanceClass, 'core', query);
  }
  for (const query of ['мягкий бак', 'гибкий бак', 'резиновый бак', 'flexible tank', 'bladder tank', 'мягкий бак для воды', 'гибкий бак для душа']) {
    assert.notEqual(classifyQuery(query, { rootSeed: query }).relevanceClass, 'core', query);
  }
  assert.equal(classifyQuery('топливный бак').relevanceClass, 'broad');
  for (const query of ['гибкий топливный насос', 'резиновый топливный шланг', 'flexible fuel filter']) {
    assert.notEqual(classifyQuery(query).relevanceClass, 'core', query);
  }
  assert.notEqual(classifyQuery('bladder').relevanceClass, 'core');
  const adjacentPump = classifyQuery('гибкий топливный насос БПЛА', { rootSeed: 'топливная система БПЛА' });
  assert.equal(adjacentPump.relevanceClass, 'adjacent');
});

test('components require a trusted domain/entity context', () => {
  for (const query of ['топливный фильтр', 'топливный насос']) assertNotEligible(classifyQuery(query));
  for (const query of ['топливный фильтр БПЛА', 'насос топливной системы БПЛА', 'fuel filter drones']) {
    const result = classifyQuery(query, { rootSeed: 'топливный бак БПЛА' });
    assert.equal(result.relevanceClass, 'adjacent');
    assert.equal(result.recursiveEligible, true);
  }
  const model = classifyQuery('DLE130G fuel tank', { rootSeed: 'DLE130G engine', entities: ['DLE130G'] });
  assert.ok(['core', 'adjacent'].includes(model.relevanceClass));
  assert.equal(model.deepEligible, true);
});

test('a domain tank without explicit fuel context is adjacent rather than core', () => {
  assert.equal(classifyQuery('топливный бак БПЛА').relevanceClass, 'core');
  for (const query of ['бак БПЛА', 'бак для воды БПЛА', 'бак для химикатов БПЛА', 'топливный фильтр БПЛА']) {
    assert.equal(classifyQuery(query).relevanceClass, 'adjacent', query);
  }
});
