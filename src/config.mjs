// Persisted semantic and eligibility decisions changed in v5.
export const ALGORITHM_VERSION = 5;

const PROFILES = Object.freeze({
  explore: Object.freeze({ maxDepth: 2, maxPerRoot: 8, maxPerRun: 1000, maxDeep: 300, maxFrequency: 100 }),
  final: Object.freeze({ maxDepth: 1, maxPerRoot: 4, maxPerRun: 500, maxDeep: 500, maxFrequency: 500 }),
});

export const RESEARCH_PROFILE = process.env.RESEARCH_PROFILE || 'explore';
if (!Object.hasOwn(PROFILES, RESEARCH_PROFILE)) throw new Error('RESEARCH_PROFILE must be "explore" or "final"');

function positiveNumber(name, fallback, integer = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'a positive integer' : 'a positive number'}`);
  }
  return value;
}

const profile = PROFILES[RESEARCH_PROFILE];
export const MAX_DEPTH = positiveNumber('MAX_DEPTH', profile.maxDepth);
export const MAX_AUTO_EXPANSIONS_PER_ROOT = positiveNumber('MAX_AUTO_EXPANSIONS_PER_ROOT', profile.maxPerRoot);
export const MAX_AUTO_EXPANSIONS_PER_RUN = positiveNumber('MAX_AUTO_EXPANSIONS_PER_RUN', profile.maxPerRun);
export const MAX_AUTO_DEEP_QUERIES = positiveNumber('MAX_AUTO_DEEP_QUERIES', profile.maxDeep);
export const MAX_FREQUENCY_VALIDATIONS = positiveNumber('MAX_FREQUENCY_VALIDATIONS', profile.maxFrequency);
export const PHANTOM_RATIO_THRESHOLD = positiveNumber('PHANTOM_RATIO_THRESHOLD', 10, false);
export const RESEARCH_PROFILES = PROFILES;
