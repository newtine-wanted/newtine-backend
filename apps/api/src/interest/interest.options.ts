export const INTEREST_OPTIONS = Symbol('INTEREST_OPTIONS');

export interface InterestOptions {
  readonly analysisWindowDays: number;
  readonly minimumSampleSize: number;
}

export class InterestConfigurationException extends Error {
  constructor(message: string) {
    super(`Interest configuration: ${message}`);
    this.name = InterestConfigurationException.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function createInterestOptions(env: NodeJS.ProcessEnv = process.env): InterestOptions {
  return {
    analysisWindowDays: positiveInteger(
      env.INTEREST_ANALYSIS_WINDOW_DAYS,
      7,
      'INTEREST_ANALYSIS_WINDOW_DAYS',
      365,
    ),
    minimumSampleSize: positiveInteger(
      env.INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE,
      10,
      'INTEREST_ANALYSIS_MINIMUM_SAMPLE_SIZE',
      100_000,
    ),
  };
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  maximum: number,
): number {
  const resolved = value ?? String(fallback);
  if (!/^\d+$/.test(resolved)) {
    throw new InterestConfigurationException(`${key} must be a positive integer`);
  }
  const parsed = Number(resolved);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new InterestConfigurationException(`${key} must be between 1 and ${maximum}`);
  }
  return parsed;
}
