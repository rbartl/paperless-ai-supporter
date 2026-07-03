import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { config as dotenvConfig } from 'dotenv';
import { Config, EnvConfig } from './types/index.js';

dotenvConfig();

export function loadConfig(): Config {
  const configPath = process.env.CONFIG_PATH || 'config.yaml';
  const fileContents = readFileSync(configPath, 'utf8');
  return parse(fileContents) as Config;
}

export function loadEnvConfig(): EnvConfig {
  const paperlessUrl = process.env.PAPERLESS_URL;
  const paperlessApiToken = process.env.PAPERLESS_API_TOKEN;

  if (!paperlessUrl) {
    throw new Error('PAPERLESS_URL environment variable is required');
  }
  if (!paperlessApiToken) {
    throw new Error('PAPERLESS_API_TOKEN environment variable is required');
  }

  const paperlessPublicUrl = process.env.PAPERLESS_PUBLIC_URL ?? paperlessUrl;

  return {
    paperlessUrl: paperlessUrl.replace(/\/$/, ''), // Remove trailing slash
    paperlessPublicUrl: paperlessPublicUrl.replace(/\/$/, ''), // Remove trailing slash
    paperlessApiToken,
    cfAccessClientId: process.env.CF_ACCESS_CLIENT_ID,
    cfAccessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
  };
}
