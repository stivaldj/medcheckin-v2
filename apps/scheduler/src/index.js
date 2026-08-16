import { loadConfig } from '@medcheckin/core';

// E0: placeholder honesto. Valida config (fail-closed) e sai. Cron/planner entram em E2/E6.
loadConfig(process.env);
console.log('[scheduler] up (E0 placeholder: sem cron ainda)');
process.exit(0);
