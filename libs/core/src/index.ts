export { CoreModule } from './core.module.js';
export { Entity } from './common/entity/base.entity.js';
export { DomainException } from './common/exception/domain.exception.js';
export { ErrorCode } from './common/exception/error.code.js';
export type { ErrorCodeValue } from './common/exception/error.code.js';
export { IssueException, IssueExceptionCode } from './issue/domain/issue.exception.js';
export type { IssueExceptionCodeValue } from './issue/domain/issue.exception.js';
export { generateUuidV7, isUuidV7 } from './common/id/uuidV7.generator.js';
export type { UuidV7 } from './common/id/uuidV7.generator.js';
export { createDatabaseOptions } from './common/database/database.options.js';
export { LoggingConfigurationException } from './common/logging/logging.exception.js';
export {
  createLoggerOptions,
  DEFAULT_HTTP_SLOW_THRESHOLD_MS,
  loggingRedactPaths,
  resolveHttpSlowThreshold,
  resolveLogLevel,
} from './common/logging/logging.options.js';
export { exceptionDiagnostic } from './common/logging/exceptionDiagnostic.js';
export type { LogLevel, LogService } from './common/logging/logging.options.js';
export { MikroOrmTransactionManager } from './common/transaction/mikroOrm/mikroOrm.transactionManager.js';
export { NestedTransactionException } from './common/transaction/transaction.exception.js';
export { TRANSACTION_MANAGER } from './common/transaction/transaction.manager.js';
export type { TransactionManager } from './common/transaction/transaction.manager.js';
