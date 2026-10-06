export interface CoreConfig {
  /**
   * Business hours that accepted-but-unconsolidated actions may age before the
   * hierarchy is flagged as stale. The spec's range is 48-72; 48 is the default.
   */
  stalenessThresholdBusinessHours: number;
}

export const defaultCoreConfig: CoreConfig = {
  stalenessThresholdBusinessHours: 48,
};

export function resolveConfig(overrides?: Partial<CoreConfig>): CoreConfig {
  return { ...defaultCoreConfig, ...overrides };
}
