import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuery, createMatcher, tokenizeQuery } from '../src/scoring.mjs';

const fuelContext = { rootSeed: 'мягкий топливный бак БПЛА', parentQuery: 'топливный бак БПЛА' };

test('Unicode token matcher does not confuse short substrings', () => {
  assert.deepEqual(tokenizeQuery('БАК, UAV!'), ['бак', 'uav']);
  assert.equal(createMatcher('Москва Баку').hasToken('бак'), false);
  assert.equal(createMatcher('фильтр бассейна').hasToken('бас'), false);
  assert.equal(createMatcher('авиационный бак').hasAllowedPrefix(['авиационн']), true);
  assert.equal(createMatcher('авиабилеты').hasAllowedPrefix(['авиационн']), false);
});

test('semantic drift is noise or non-recursive', () => {
  for (const query of ['москва баку авиабилеты цена', 'авиабилеты москва баку', 'купить фильтр для бассейна', 'песочный фильтр бассейна bestway']) {
    const result = classifyQuery(query, fuelContext);
    assert.equal(result.relevanceClass, 'noise', query);
    assert.equal(result.recursiveEligible, false, query);
    assert.equal(result.deepEligible, false, query);
  }
  for (const query of ['топливный насос вебасто', 'топливный фильтр toyota']) assert.equal(classifyQuery(query, fuelContext).recursiveEligible, false);
  for (const query of ['авиационное топливо', 'топливный фильтр', 'горловина топливного бака']) {
    const result = classifyQuery(query, fuelContext);
    assert.equal(result.relevanceClass, 'broad', query);
    assert.equal(result.recursiveEligible, false, query);
  }
});

test('negative vehicle tokens always override otherwise strong product signals', () => {
  for (const query of ['топливный бак ВАЗ', 'топливный бак КамАЗ']) {
    const result = classifyQuery(query, fuelContext);
    assert.equal(result.relevanceClass, 'noise', query);
    assert.equal(result.recursiveEligible, false, query);
    assert.equal(result.deepEligible, false, query);
  }
  const unrelatedModel = classifyQuery('редукционный клапан топливный 4hk1 купить', { rootSeed: 'мягкий бак БПЛА' });
  assert.equal(unrelatedModel.recursiveEligible, false);
  assert.equal(unrelatedModel.deepEligible, false);
});

test('fuel/UAV engineering queries remain eligible', () => {
  for (const query of ['мягкий топливный бак', 'авиационный мягкий топливный бак', 'топливный бак БПЛА', 'UAV fuel tank', 'мягкие топливные баки для БПЛА', 'UAV fuel tanks', 'топливные баки для дронов']) {
    assert.equal(classifyQuery(query, fuelContext).relevanceClass, 'core', query);
  }
  for (const query of ['топливный фильтр БПЛА', 'насос топливной системы БПЛА']) {
    const result = classifyQuery(query, fuelContext);
    assert.equal(result.relevanceClass, 'adjacent', query);
    assert.equal(result.recursiveEligible, true, query);
  }
  for (const query of ['фильтры для БПЛА', 'насосы БПЛА', 'шланги для дронов', 'трубки БПЛА', 'клапаны для дронов']) {
    const result = classifyQuery(query, fuelContext);
    assert.equal(result.relevanceClass, 'adjacent', query);
    assert.equal(result.recursiveEligible, true, query);
    assert.equal(result.deepEligible, true, query);
  }
});

test('configured entities and equipment models are strong contextual anchors', () => {
  for (const [query, entity, rootSeed] of [['DLE130G fuel tank', 'DLE130G', 'DLE130G engine'], ['DLE130G fuel system', 'DLE130G', 'DLE130G engine'], ['CUAV autopilot', 'CUAV', 'CUAV ecosystem'], ['T-Motor U15', 'T-Motor', 'T-Motor components']]) {
    const result = classifyQuery(query, { rootSeed, entities: [entity], relationType: 'DIRECT' });
    assert.ok(['core', 'adjacent'].includes(result.relevanceClass), query);
    assert.equal(result.recursiveEligible, true, query);
  }
});
