export class LoggingConfigurationException extends Error {
  constructor(variable: string, reason: string) {
    super(`${variable}: ${reason}`);
    this.name = 'LoggingConfigurationException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
