import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeQuery,normalizeUrl} from '../src/scoring.mjs';import {parseInput,expandBrands} from '../src/research.mjs';
test('normalizeQuery',()=>assert.equal(normalizeQuery('  Ёж\t БАК  '),'еж бак'));
test('normalizeUrl',()=>assert.equal(normalizeUrl('HTTPS://Example.COM/a/?utm_x=1&ok=2#x'),'https://example.com/a?ok=2'));
test('input parser',()=>assert.deepEqual(parseInput('# x\n seed \n@brand Haoye\n'),{seeds:['seed'],brands:['Haoye']}));
test('brand expansion',()=>{const x=expandBrands(['Haoye']);assert.equal(x.length,13);assert.ok(x.includes('Haoye fuel tank'));assert.ok(x.includes('топливный бак Haoye'));});
