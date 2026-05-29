/** No Settings row exists for the user; cannot build a schedule. */
export class SettingsRequiredError extends Error {
  constructor(userId: string) {
    super(`No settings found for user ${userId}`);
    this.name = 'SettingsRequiredError';
  }
}

/** The provided IANA timezone string is not valid. */
export class InvalidTimezoneError extends Error {
  constructor(timezone: string) {
    super(`Invalid timezone: ${timezone}`);
    this.name = 'InvalidTimezoneError';
  }
}

/** horizonDays must be a positive number. */
export class InvalidHorizonError extends Error {
  constructor(horizonDays: number) {
    super(`horizonDays must be > 0, got ${horizonDays}`);
    this.name = 'InvalidHorizonError';
  }
}
