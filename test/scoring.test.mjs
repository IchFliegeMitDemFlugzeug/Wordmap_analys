import test from 'node:test';import assert from 'node:assert/strict';import {scoreQuery} from '../src/scoring.mjs';
test('fixed scoring',()=>{assert.equal(scoreQuery('купить бак БПЛА'),11);assert.equal(scoreQuery('бак ваз'),-3);assert.equal(scoreQuery('Haoye fuel tank',{brands:['Haoye'],manualSeed:true}),106);});
