import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.endsWith('_validation.ts'))
  .sort();

console.log('================================================================');
console.log(` KEEPR AUTOMATED REGRESSION SUITE (${testFiles.length} Test Suites)`);
console.log('================================================================\n');

let failedSuites = 0;
const results: { file: string; passed: boolean; duration: number }[] = [];

for (const file of testFiles) {
  const filePath = path.join(testDir, file);
  console.log(`▶ Running ${file}...`);
  const startTime = Date.now();
  
  const result = spawnSync(`npx tsx "${filePath}"`, {
    stdio: 'inherit',
    shell: true,
  });
  
  const duration = Date.now() - startTime;
  const passed = result.status === 0;
  if (!passed) {
    failedSuites++;
  }
  results.push({ file, passed, duration });
  console.log('');
}

console.log('================================================================');
console.log(' TEST SUITE EXECUTION SUMMARY');
console.log('================================================================');
for (const r of results) {
  const icon = r.passed ? '✓' : '✗';
  const status = r.passed ? 'PASSED' : 'FAILED';
  console.log(`  ${icon} ${r.file.padEnd(45)} ${status.padEnd(8)} (${(r.duration / 1000).toFixed(2)}s)`);
}
console.log('----------------------------------------------------------------');
console.log(`Total: ${testFiles.length} | Passed: ${testFiles.length - failedSuites} | Failed: ${failedSuites}`);
console.log('================================================================\n');

if (failedSuites > 0) {
  process.exit(1);
}
