import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log(' KEEPR: EMPTY STATE UI CONSISTENCY REGRESSION VALIDATION');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

const ROOT = path.resolve(__dirname, '..');
const itemsPath = path.join(ROOT, 'app', '(tabs)', 'items.tsx');
const docsPath = path.join(ROOT, 'app', '(tabs)', 'documents.tsx');
const servicesPath = path.join(ROOT, 'app', '(tabs)', 'services.tsx');
const emptyStatePath = path.join(ROOT, 'src', 'components', 'ui', 'EmptyState.tsx');

const itemsContent = fs.readFileSync(itemsPath, 'utf8');
const docsContent = fs.readFileSync(docsPath, 'utf8');
const servicesContent = fs.readFileSync(servicesPath, 'utf8');
const emptyStateContent = fs.readFileSync(emptyStatePath, 'utf8');

// 1. Shared EmptyState Component Design & Token Conformance
test('Shared EmptyState component has unified tokens and card styling', () => {
  assert(emptyStateContent.includes('bg-serene-surface-container-lowest'), 'Must use lowest surface (pure white card)');
  assert(emptyStateContent.includes('rounded-serene-xl'), 'Must use xl rounded corners');
  assert(emptyStateContent.includes('border-serene-subtle-border'), 'Must use subtle border token');
  assert(emptyStateContent.includes('w-[60px] h-[60px] rounded-full'), 'Must use standard 60x60 circular icon container');
  assert(emptyStateContent.includes('text-[17px] font-bold text-serene-on-surface'), 'Title must match 17px bold text');
  assert(emptyStateContent.includes('text-[13px] text-serene-on-surface-variant'), 'Description must match 13px text');
  assert(emptyStateContent.includes('actionVariant?: \'primary\' | \'secondary\''), 'Must support primary and secondary action button variants');
});

// 2. Items Screen Empty State Reference Unchanged
test('Items screen retains reference empty state implementation', () => {
  assert(itemsContent.includes('title="Your collection is empty"'), 'Items title matches');
  assert(itemsContent.includes('actionText="Add your first item"'), 'Items action text matches');
  assert(itemsContent.includes('pathname: \'/(tabs)/add\''), 'Items navigation path matches');
});

// 3. Documents Screen Empty State Conformance & Navigation
test('Documents screen uses shared EmptyState card and preserves navigation to /document/add', () => {
  assert(docsContent.includes("import { EmptyState } from '../../src/components/ui/EmptyState';"), 'Documents screen imports shared EmptyState');
  assert(docsContent.includes('title="No documents in vault"'), 'Documents heading matches');
  assert(docsContent.includes('icon="folder-open"'), 'Documents uses folder-open icon');
  assert(docsContent.includes('actionText="Add First Document"'), 'Documents button label matches');
  assert(docsContent.includes("router.push('/document/add' as any)"), 'Documents action pushes to /document/add');
  assert(docsContent.includes('Store invoices, RC, insurance policies, college receipts, and utility bills safely.'), 'Documents description matches');
});

// 4. Service & Repair Screen Empty State Conformance & Navigation
test('Service screen uses shared EmptyState card and preserves navigation to /service/add', () => {
  assert(servicesContent.includes("import { EmptyState } from '../../src/components/ui/EmptyState';"), 'Services screen imports shared EmptyState');
  assert(servicesContent.includes('title="No Service Records Yet"'), 'Services heading matches');
  assert(servicesContent.includes('icon="build"'), 'Services uses build (wrench) icon');
  assert(servicesContent.includes('actionText="Add First Service"'), 'Services button label matches');
  assert(servicesContent.includes("router.push('/service/add' as any)"), 'Services action pushes to /service/add');
  assert(servicesContent.includes('Track repairs, maintenance, and part replacements for your purchased items.'), 'Services description matches');
});

// 5. Secondary / Filter Empty States also conform
test('Documents and Services filter empty states use consistent EmptyState cards', () => {
  assert(docsContent.includes('icon="search-off"'), 'Documents search empty state uses search-off');
  assert(docsContent.includes('icon="filter-alt-off"'), 'Documents filter empty state uses filter-alt-off');
  assert(servicesContent.includes('title="No Matching Service Records"'), 'Services filtered empty state uses EmptyState');
});

console.log('\n================================================================');
console.log(` ALL CHECKS PASSED: ${passedTests}/${totalTests} tests successful.`);
console.log('================================================================\n');
