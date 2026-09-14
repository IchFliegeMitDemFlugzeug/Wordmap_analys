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
});

test('flexible fuel tanks are the target product without a UAV word', () => {
  for (const query of ['мягкий топливный бак', 'мягкий бак', 'гибкий топливный бак', 'эластичный топливный бак', 'резиновый топливный бак', 'авиационный мягкий топливный бак', 'flexible fuel tank', 'fuel bladder', 'bladder tank']) {
    const result = classifyQuery(query, { rootSeed: 'мягкий топливный бак' });
    assert.equal(result.relevanceClass, 'core', query);
    assert.equal(result.recursiveEligible, true, query);
    assert.equal(result.deepEligible, true, query);
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
