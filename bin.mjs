#!/usr/bin/env node

/**
 * Workaround to allow `rimraf dist/` on rebuilds and keep `bin` executable
 * without a need `yarn install`
 */

import { program } from './dist/program.js';

program.parse(process.argv);
