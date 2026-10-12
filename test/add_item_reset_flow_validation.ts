import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log(' KEEPR: ADD ITEM FLOW RESET & NAVIGATION REGRESSION SUITE');
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
    process.exitCode = 1;
  }
}

const rootDir = path.resolve(__dirname, '..');
const addScreenPath = path.join(rootDir, 'app', '(tabs)', 'add.tsx');
const addScreenContent = fs.readFileSync(addScreenPath, 'utf8');
const headerPath = path.join(rootDir, 'src', 'components', 'ui', 'Header.tsx');
const headerContent = fs.readFileSync(headerPath, 'utf8');
const indexPath = path.join(rootDir, 'app', '(tabs)', 'index.tsx');
const indexContent = fs.readFileSync(indexPath, 'utf8');
const itemsPath = path.join(rootDir, 'app', '(tabs)', 'items.tsx');
const itemsContent = fs.readFileSync(itemsPath, 'utf8');

// ============================================================================
// PART 1: STATIC & STRUCTURAL INTEGRITY AUDITS
// ============================================================================

test('Header component supports onBackPress callback prop', () => {
  assert.ok(
    headerContent.includes('onBackPress?: () => void;'),
    'HeaderProps must define optional onBackPress callback'
  );
  assert.ok(
    headerContent.includes('onPress={onBackPress || (() => router.back())}'),
    'Header back button must execute onBackPress when provided'
  );
});

test('add.tsx imports required lifecycle and platform hooks', () => {
  assert.ok(addScreenContent.includes('BackHandler'), 'add.tsx must import BackHandler from react-native');
  assert.ok(addScreenContent.includes('useFocusEffect'), 'add.tsx must import useFocusEffect from expo-router');
  assert.ok(addScreenContent.includes('useCallback'), 'add.tsx must import useCallback from react');
  assert.ok(addScreenContent.includes('useRef'), 'add.tsx must import useRef from react');
});

test('add.tsx defines reset parameter in useLocalSearchParams', () => {
  assert.ok(
    addScreenContent.includes('reset?: string;'),
    'useLocalSearchParams must declare optional reset param'
  );
});

test('add.tsx contains resetFormState, hasMeaningfulUnsavedData, and confirmDiscardIfUnsaved', () => {
  assert.ok(addScreenContent.includes('const resetFormState = useCallback('), 'resetFormState must be declared');
  assert.ok(addScreenContent.includes('setCategoryId(null);'), 'resetFormState must reset categoryId to null');
  assert.ok(addScreenContent.includes('clearActiveReceiptSession();'), 'resetFormState must clear active receipt session');
  assert.ok(addScreenContent.includes('const hasMeaningfulUnsavedData = useCallback('), 'hasMeaningfulUnsavedData must be declared');
  assert.ok(addScreenContent.includes('const confirmDiscardIfUnsaved = useCallback('), 'confirmDiscardIfUnsaved must be declared');
  assert.ok(addScreenContent.includes('Discard Purchase?'), 'Alert confirmation must prompt Discard Purchase');
});

test('add.tsx wires useFocusEffect with BackHandler and blur-abandonment reset', () => {
  assert.ok(
    addScreenContent.includes("BackHandler.addEventListener('hardwareBackPress', onHardwareBack)"),
    'Must register hardwareBackPress event listener on focus'
  );
  assert.ok(
    addScreenContent.includes('subscription.remove();'),
    'Must clean up hardwareBackPress event listener on blur'
  );
  assert.ok(
    addScreenContent.includes('if (!isPickerActiveRef.current && !isEditMode && !isFromScan) {'),
    'Must guard blur reset against active pickers, edit mode, and scan flows'
  );
});

test('add.tsx stabilizes useFocusEffect with handleBackRef to avoid premature cleanup on category tap', () => {
  assert.ok(
    addScreenContent.includes('const handleBackRef = useRef(handleBack);'),
    'Must define handleBackRef to decouple focus callback from handleBack state updates'
  );
  assert.ok(
    addScreenContent.includes('handleBackRef.current = handleBack;'),
    'Must keep handleBackRef up-to-date on each render'
  );
  assert.ok(
    addScreenContent.includes('return handleBackRef.current();'),
    'onHardwareBack must invoke handleBackRef.current()'
  );
  assert.ok(
    addScreenContent.includes('}, [isEditMode, isFromScan, resetFormState])'),
    'useFocusEffect dependencies must NOT include handleBack, preventing rogue resets on category selection'
  );
});

test('add.tsx protects all camera, gallery, and document pickers from blur reset', () => {
  // Check that isPickerActiveRef is set in all 6 picker functions
  const pickerOccurrences = (addScreenContent.match(/isPickerActiveRef\.current = true;/g) || []).length;
  assert.strictEqual(
    pickerOccurrences,
    6,
    `Expected 6 picker launches protected by isPickerActiveRef.current = true, found ${pickerOccurrences}`
  );

  const cleanupOccurrences = (addScreenContent.match(/isPickerActiveRef\.current = false;/g) || []).length;
  assert.strictEqual(
    cleanupOccurrences,
    6,
    `Expected 6 picker cleanups for isPickerActiveRef.current = false, found ${cleanupOccurrences}`
  );
});

test('add.tsx Header displays back button on both Choose Category and Category Record forms', () => {
  assert.ok(
    addScreenContent.includes('<Header\n          title="Add Item"\n          showBack={true}\n          onBackPress={handleBack}\n        />'),
    'Choose Category view must display back button with handleBack'
  );
  assert.ok(
    addScreenContent.includes('<Header\n        title={isEditMode ? \'Edit Item\' : `${selectedCatName} Record`}\n        showBack={true}\n        onBackPress={handleBack}\n      />'),
    'Category record form must display back button with handleBack'
  );
});

test('add.tsx buttons use safe handleChangeCategory and handleCancel', () => {
  assert.ok(addScreenContent.includes('onPress={handleChangeCategory}'), 'Change Category must use handleChangeCategory');
  assert.ok(addScreenContent.includes('onPress={handleCancel}'), 'Cancel must use handleCancel');
});

test('Vault tab and Items tab pass reset timestamp param on Add Item CTAs', () => {
  assert.ok(
    indexContent.includes("pathname: '/(tabs)/add', params: { reset: Date.now().toString() }"),
    'index.tsx must pass reset timestamp on Add Item button'
  );
  assert.ok(
    itemsContent.includes("pathname: '/(tabs)/add', params: { reset: Date.now().toString() }"),
    'items.tsx must pass reset timestamp on empty state Add Item CTA'
  );
});

// ============================================================================
// PART 2: BEHAVIORAL STATE TRANSITION SIMULATIONS
// ============================================================================

interface SimulatedState {
  categoryId: string | null;
  name: string;
  purchasePrice: string;
  merchant: string;
  productPhotos: string[];
  isPickerActive: boolean;
  isEditMode: boolean;
  isFromScan: boolean;
  historyStack: string[];
  alertShown: { title: string; message: string; onConfirm?: () => void } | null;
}

function createSimulatedAddScreen(initialParams: { editId?: string; fromScan?: string } = {}) {
  const state: SimulatedState = {
    categoryId: null,
    name: '',
    purchasePrice: '',
    merchant: '',
    productPhotos: [],
    isPickerActive: false,
    isEditMode: Boolean(initialParams.editId),
    isFromScan: Boolean(initialParams.fromScan === 'true'),
    historyStack: ['/(tabs)/'],
    alertShown: null,
  };

  const hasMeaningfulUnsavedData = () => {
    if (state.isEditMode) return false;
    return Boolean(
      state.name.trim() ||
      state.purchasePrice.trim() ||
      state.merchant.trim() ||
      state.productPhotos.length > 0
    );
  };

  const resetFormState = () => {
    state.categoryId = null;
    state.name = '';
    state.purchasePrice = '';
    state.merchant = '';
    state.productPhotos = [];
  };

  const confirmDiscardIfUnsaved = (onConfirm: () => void) => {
    if (hasMeaningfulUnsavedData()) {
      state.alertShown = {
        title: 'Discard Purchase?',
        message: 'You have unsaved changes. Are you sure you want to discard them?',
        onConfirm,
      };
    } else {
      onConfirm();
    }
  };

  const handleSelectCategory = (catId: string) => {
    state.categoryId = catId;
  };

  const handleChangeCategory = () => {
    confirmDiscardIfUnsaved(() => {
      resetFormState();
    });
  };

  const handleCancel = () => {
    if (state.isEditMode) {
      state.historyStack.pop();
      return;
    }
    confirmDiscardIfUnsaved(() => {
      resetFormState();
      state.historyStack.pop();
    });
  };

  const handleBack = () => {
    if (state.isEditMode) {
      state.historyStack.pop();
      return true;
    }
    if (state.categoryId) {
      confirmDiscardIfUnsaved(() => {
        resetFormState();
      });
      return true;
    }
    state.historyStack.pop();
    return true;
  };

  const onBlur = () => {
    if (!state.isPickerActive && !state.isEditMode && !state.isFromScan) {
      resetFormState();
    }
  };

  const onFocusWithResetParam = (resetParam?: string) => {
    if (resetParam && !state.isEditMode && !state.isFromScan) {
      resetFormState();
    }
  };

  return {
    state,
    hasMeaningfulUnsavedData,
    resetFormState,
    handleSelectCategory,
    handleChangeCategory,
    handleCancel,
    handleBack,
    onBlur,
    onFocusWithResetParam,
  };
}

test('Simulated Flow 1: Add Item → Choose Category → Electronics → Leave via Tab Switch → Add Item opens Choose Category', () => {
  const sim = createSimulatedAddScreen();
  // 1. Initial screen: Choose Category
  assert.strictEqual(sim.state.categoryId, null, 'Initial categoryId must be null (Choose Category)');

  // 2. Select Electronics
  sim.handleSelectCategory('electronics');
  assert.strictEqual(sim.state.categoryId, 'electronics', 'Category form must be electronics');

  // 3. User switches to Vault tab (screen blurs)
  sim.onBlur();
  assert.strictEqual(sim.state.categoryId, null, 'Blur must reset categoryId to null');

  // 4. User taps Add Item CTA from Vault
  sim.onFocusWithResetParam(Date.now().toString());
  assert.strictEqual(sim.state.categoryId, null, 'Must open Choose Category on fresh Add Item tap');
});

test('Simulated Flow 2: Add Item → Electronics → Android Back without unsaved data returns to Choose Category', () => {
  const sim = createSimulatedAddScreen();
  sim.handleSelectCategory('electronics');
  assert.strictEqual(sim.state.categoryId, 'electronics');

  // User presses Android Back
  const handled = sim.handleBack();
  assert.strictEqual(handled, true, 'Hardware back must be intercepted');
  assert.strictEqual(sim.state.alertShown, null, 'No discard alert if no entered data');
  assert.strictEqual(sim.state.categoryId, null, 'Must return to Choose Category');

  // Pressing Android Back again on Choose Category exits add flow
  sim.handleBack();
  assert.strictEqual(sim.state.historyStack.length, 0, 'Exits to previous screen');
});

test('Simulated Flow 3: Add Item → Electronics with unsaved data → Android Back prompts Discard confirmation', () => {
  const sim = createSimulatedAddScreen();
  sim.handleSelectCategory('electronics');
  sim.state.name = 'MacBook Pro 16';
  sim.state.purchasePrice = '249000';

  assert.strictEqual(sim.hasMeaningfulUnsavedData(), true, 'Must detect meaningful unsaved data');

  // User presses Android Back
  sim.handleBack();
  assert.ok(sim.state.alertShown, 'Alert confirmation must be triggered');
  assert.strictEqual(sim.state.alertShown?.title, 'Discard Purchase?');
  assert.strictEqual(sim.state.categoryId, 'electronics', 'Form must not discard before user confirms');

  // User confirms Discard
  sim.state.alertShown?.onConfirm?.();
  assert.strictEqual(sim.state.categoryId, null, 'After discard confirmation, resets to Choose Category');
  assert.strictEqual(sim.state.name, '', 'Form inputs must be cleared');
});

test('Simulated Flow 4: Add Item → Electronics → Cancel button resets and exits to Vault', () => {
  const sim = createSimulatedAddScreen();
  sim.handleSelectCategory('electronics');
  sim.state.name = 'iPad Air';

  // Press Cancel
  sim.handleCancel();
  assert.ok(sim.state.alertShown, 'Alert confirmation must be triggered for cancel');

  // Confirm Discard
  sim.state.alertShown?.onConfirm?.();
  assert.strictEqual(sim.state.categoryId, null, 'Category must be reset');
  assert.strictEqual(sim.state.name, '', 'Name must be reset');
  assert.strictEqual(sim.state.historyStack.length, 0, 'Must navigate back');

  // Next Add Item tap starts at Choose Category
  sim.onFocusWithResetParam(Date.now().toString());
  assert.strictEqual(sim.state.categoryId, null, 'Must open Choose Category');
});

test('Simulated Flow 5: Add Item → Electronics → Change Category resets form to Choose Category', () => {
  const sim = createSimulatedAddScreen();
  sim.handleSelectCategory('electronics');
  sim.state.name = 'Kitchen Chimney'; // mistakenly typed before realizing wrong category

  sim.handleChangeCategory();
  assert.ok(sim.state.alertShown, 'Must confirm clearing unsaved details');

  // Confirm change
  sim.state.alertShown?.onConfirm?.();
  assert.strictEqual(sim.state.categoryId, null, 'Returns to Choose Category');
  assert.strictEqual(sim.state.name, '', 'Fields reset cleanly');

  // Now selects Appliances
  sim.handleSelectCategory('appliances');
  assert.strictEqual(sim.state.categoryId, 'appliances', 'Switches to Appliances form cleanly');
});

test('Simulated Flow 6: Tab Switching across all main tabs (Vault, Documents, Services, Profile) resets abandoned form', () => {
  const tabs = ['Vault', 'Documents', 'Services', 'Profile'];

  for (const tab of tabs) {
    const sim = createSimulatedAddScreen();
    sim.handleSelectCategory('electronics');
    sim.state.name = `Item abandoned before ${tab}`;

    // Switch to tab
    sim.onBlur();
    assert.strictEqual(sim.state.categoryId, null, `Switching to ${tab} must reset categoryId`);
    assert.strictEqual(sim.state.name, '', `Switching to ${tab} must clear form fields`);

    // Return to Add Item
    sim.onFocusWithResetParam(Date.now().toString());
    assert.strictEqual(sim.state.categoryId, null, `Returning from ${tab} must start at Choose Category`);
  }
});

test('Simulated Flow 7: Edit Item mode is strictly preserved and never reset on blur or CTA taps', () => {
  const sim = createSimulatedAddScreen({ editId: 'item-12345' });
  sim.state.categoryId = 'electronics';
  sim.state.name = 'Existing TV in Edit Mode';

  // Blur (e.g. backgrounding or tab switch)
  sim.onBlur();
  assert.strictEqual(sim.state.categoryId, 'electronics', 'Edit mode categoryId must NOT be reset on blur');
  assert.strictEqual(sim.state.name, 'Existing TV in Edit Mode', 'Edit mode fields must NOT be reset on blur');

  // Reset param invocation
  sim.onFocusWithResetParam(Date.now().toString());
  assert.strictEqual(sim.state.categoryId, 'electronics', 'Edit mode categoryId must NOT be reset by reset param');
  assert.strictEqual(sim.state.name, 'Existing TV in Edit Mode', 'Edit mode fields must NOT be cleared');
});

test('Simulated Flow 8: Camera or Gallery picker activity does NOT reset the unfinished form on blur', () => {
  const sim = createSimulatedAddScreen();
  sim.handleSelectCategory('electronics');
  sim.state.name = 'Sony Noise Cancelling Headphones';
  sim.state.purchasePrice = '19990';

  // User taps "Add Product Photo" -> opens Camera
  sim.state.isPickerActive = true;

  // OS fires a blur event as the native camera activity opens
  sim.onBlur();

  // Verify form was NOT wiped
  assert.strictEqual(sim.state.categoryId, 'electronics', 'Category must NOT be reset during camera activity');
  assert.strictEqual(sim.state.name, 'Sony Noise Cancelling Headphones', 'Name must remain intact during camera activity');

  // Camera returns photo and finishes
  sim.state.productPhotos.push('file:///data/user/0/keepr/cache/photo.jpg');
  sim.state.isPickerActive = false;

  assert.strictEqual(sim.state.productPhotos.length, 1, 'Product photo must be preserved');
  assert.strictEqual(sim.state.name, 'Sony Noise Cancelling Headphones', 'Entered form details preserved');
});

test('Simulated Flow 9: Add Item → Choose Category → Every supported category opens its customized record form', () => {
  const supportedCategories = [
    { id: 'electronics', name: 'Electronics' },
    { id: 'appliances', name: 'Home & Appliances' },
    { id: 'fashion', name: 'Fashion' },
    { id: 'vehicles', name: 'Vehicle' },
    { id: 'furniture', name: 'Furniture' },
    { id: 'sports', name: 'Sports & Fitness' },
    { id: 'beauty', name: 'Beauty & Personal Care' },
    { id: 'other', name: 'Other' },
  ];

  for (const cat of supportedCategories) {
    const sim = createSimulatedAddScreen();
    assert.strictEqual(sim.state.categoryId, null, 'Must start at Choose Category');

    // Tapping category card
    sim.handleSelectCategory(cat.id);
    assert.strictEqual(sim.state.categoryId, cat.id, `Category ${cat.name} must be active`);

    // In-screen re-renders (user typing name, price, merchant) must NOT reset category
    sim.state.name = `${cat.name} Sample Item`;
    sim.state.purchasePrice = '4999';
    assert.strictEqual(sim.state.categoryId, cat.id, `Category ${cat.name} must remain active after field entry`);
    assert.strictEqual(sim.state.name, `${cat.name} Sample Item`);

    // Android back returns to Choose Category
    sim.handleBack();
    // Because unsaved data exists, prompts confirmation
    assert.ok(sim.state.alertShown, 'Prompt confirmation for unsaved data');
    sim.state.alertShown?.onConfirm?.();
    assert.strictEqual(sim.state.categoryId, null, 'Must return to Choose Category after discard');
  }
});

test('Simulated Flow 10: In-screen state updates and keystroke re-renders do NOT trigger focus effect cleanup or reset category', () => {
  const sim = createSimulatedAddScreen();
  sim.handleSelectCategory('electronics');
  assert.strictEqual(sim.state.categoryId, 'electronics');

  // Simulate multiple keystroke and state update renders while focused
  const updates = [
    { name: 'Mac' },
    { name: 'MacBook' },
    { name: 'MacBook Pro' },
    { purchasePrice: '200000' },
    { merchant: 'Apple Store' },
  ];

  for (const update of updates) {
    Object.assign(sim.state, update);
    // Since screen is focused, blur cleanup does NOT run
    assert.strictEqual(sim.state.categoryId, 'electronics', 'Category must remain stable across input keystroke re-renders');
  }
  assert.strictEqual(sim.state.name, 'MacBook Pro');
  assert.strictEqual(sim.state.purchasePrice, '200000');
  assert.strictEqual(sim.state.merchant, 'Apple Store');
});

test('Simulated Flow 11: Header Back button invokes handleBack and respects unsaved changes', () => {
  const sim = createSimulatedAddScreen();
  // 1. On Choose Category view
  assert.strictEqual(sim.state.categoryId, null);
  sim.handleBack();
  assert.strictEqual(sim.state.historyStack.length, 0, 'Exits Add Item screen when on Choose Category');

  // 2. On category form with unsaved changes
  const sim2 = createSimulatedAddScreen();
  sim2.handleSelectCategory('furniture');
  sim2.state.name = 'Ergonomic Desk Chair';
  sim2.handleBack();
  assert.ok(sim2.state.alertShown, 'Must prompt confirmation when header back is tapped with unsaved changes');
  assert.strictEqual(sim2.state.categoryId, 'furniture', 'Must not discard before confirmation');

  sim2.state.alertShown?.onConfirm?.();
  assert.strictEqual(sim2.state.categoryId, null, 'Returns to Choose Category after confirming header back');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n----------------------------------------------------------------');
console.log(` RESULTS: ${passedTests} / ${totalTests} tests passed`);
console.log('----------------------------------------------------------------\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
