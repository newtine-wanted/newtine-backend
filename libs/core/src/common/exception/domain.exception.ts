export abstract class DomainException<TCode extends string = string> extends Error {
  abstract readonly domain: string;
  readonly code: TCode;

  protected constructor(code: TCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
