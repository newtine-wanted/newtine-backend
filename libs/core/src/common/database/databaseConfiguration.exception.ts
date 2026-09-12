export class DatabaseConfigurationException extends Error {
  constructor(variable: string, reason: string) {
    super(`${variable}: ${reason}`);
    this.name = 'DatabaseConfigurationException';
  }
}
