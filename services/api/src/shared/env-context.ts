export type AppEnv = 'prod' | 'staging' | 'test';

let _currentEnv: AppEnv = 'prod';

export function setEnvironmentFromOrigin(origin: string | undefined): void {
  if (origin?.includes('lux-learning-staging')) _currentEnv = 'staging';
  else if (origin?.includes('lux-learning-test')) _currentEnv = 'test';
  else _currentEnv = 'prod';
}

export function getCurrentEnv(): AppEnv {
  return _currentEnv;
}

/** Returns the DynamoDB table name with the correct env suffix. */
export function getTableName(baseName: string): string {
  if (_currentEnv === 'staging') return `${baseName}-Staging`;
  if (_currentEnv === 'test') return `${baseName}-Test`;
  return baseName;
}

/** Returns the Secrets Manager ARN for the current env's Neon DB. */
export function getDbSecretArn(): string {
  if (_currentEnv === 'staging') {
    return process.env.DB_SECRET_ARN_STAGING
      ?? 'arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-staging';
  }
  if (_currentEnv === 'test') {
    return process.env.DB_SECRET_ARN_TEST
      ?? 'arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-test';
  }
  return process.env.DB_SECRET_ARN
    ?? 'arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-bp488g';
}
