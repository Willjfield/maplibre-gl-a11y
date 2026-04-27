#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2];

if (!inputPath) {
  throw new Error('Please provide a path to a JSON file.');
}

const resolvedPath = path.resolve(process.cwd(), inputPath);
const filename = path.basename(resolvedPath);

try {
  fs.readFileSync(resolvedPath, 'utf8');
  console.log(`Read ${filename} successfully`);
} catch (error) {
  throw new Error(`Failed to read "${resolvedPath}": ${error.message}`);
}
