#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, loadEnvConfig } from './config.js';
import { PaperlessClient } from './clients/paperless.js';
import { LlmClient } from './clients/llm.js';
import { InvoiceProcessor } from './services/invoice-processor.js';

const program = new Command();

program
  .name('paperless-ai-supporter')
  .description('CLI tool to extract invoice data from Paperless-ngx documents using LLM')
  .version('1.0.0');

program
  .command('process')
  .description('Process all documents with the configured tag')
  .option('--id <id>', 'Process a specific document by ID')
  .option('--limit <n>', 'Limit number of documents to process')
  .action(async (options) => {
    try {
      const config = loadConfig();
      const envConfig = loadEnvConfig();

      const paperless = new PaperlessClient(envConfig);
      const llm = new LlmClient(config.llm);
      const resolvedFields = await paperless.resolveCustomFields(config.customFields);
      const processor = new InvoiceProcessor(paperless, llm, config, resolvedFields);

      let results;
      if (options.id) {
        const result = await processor.processDocument(parseInt(options.id, 10), false);
        results = [result];
      } else {
        const limit = options.limit ? parseInt(options.limit, 10) : undefined;
        results = await processor.processAllTaggedDocuments(false, limit);
      }

      processor.printSummary(results, false);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('dry-run')
  .description('Show what would be extracted without updating documents')
  .option('--id <id>', 'Process a specific document by ID')
  .option('--limit <n>', 'Limit number of documents to process')
  .action(async (options) => {
    try {
      const config = loadConfig();
      const envConfig = loadEnvConfig();

      const paperless = new PaperlessClient(envConfig);
      const llm = new LlmClient(config.llm);
      const resolvedFields = await paperless.resolveCustomFields(config.customFields);
      const processor = new InvoiceProcessor(paperless, llm, config, resolvedFields);

      console.log('[DRY RUN MODE] No changes will be made\n');

      let results;
      if (options.id) {
        const result = await processor.processDocument(parseInt(options.id, 10), true);
        results = [result];
      } else {
        const limit = options.limit ? parseInt(options.limit, 10) : undefined;
        results = await processor.processAllTaggedDocuments(true, limit);
      }

      processor.printSummary(results, true);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('list-fields')
  .description('List all custom fields configured in Paperless-ngx')
  .action(async () => {
    try {
      const envConfig = loadEnvConfig();
      const paperless = new PaperlessClient(envConfig);

      console.log('Fetching custom fields from Paperless-ngx...\n');
      const fields = await paperless.getCustomFields();

      if (fields.length === 0) {
        console.log('No custom fields found.');
        console.log('Create custom fields in Paperless-ngx admin to use this tool.');
        return;
      }

      console.log('Custom Fields:');
      console.log('-'.repeat(50));
      for (const field of fields) {
        console.log(`  ID: ${field.id}`);
        console.log(`  Name: ${field.name}`);
        console.log(`  Type: ${field.data_type}`);
        console.log('-'.repeat(50));
      }

      console.log('\nUpdate config.yaml with the correct field IDs:');
      console.log('customFields:');
      console.log('  invoiceNumber: <ID>');
      console.log('  bookingDate: <ID>');
      console.log('  invoiceDate: <ID>');
      console.log('  invoiceTotal: <ID>');
      console.log('  vendor: <ID>');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('list-tags')
  .description('List all tags configured in Paperless-ngx')
  .action(async () => {
    try {
      const envConfig = loadEnvConfig();
      const paperless = new PaperlessClient(envConfig);

      console.log('Fetching tags from Paperless-ngx...\n');
      const tags = await paperless.getTags();

      if (tags.length === 0) {
        console.log('No tags found.');
        return;
      }

      console.log('Tags:');
      console.log('-'.repeat(30));
      for (const tag of tags) {
        console.log(`  ${tag.id}: ${tag.name}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
