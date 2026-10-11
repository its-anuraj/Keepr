import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log(' KEEPR: ANDROID SYSTEM NAVIGATION BAR CONFIGURATION SUITE');
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

// 1. Check package.json dependency
test('package.json contains expo-navigation-bar dependency compatible with Expo SDK 57', () => {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(pkg.dependencies['expo-navigation-bar'], 'expo-navigation-bar must be present in dependencies');
  assert.strictEqual(pkg.dependencies['expo'], '~57.0.27', 'Expo version is SDK 57');
});

// 2. Check app.json config plugin
test('app.json configures expo-navigation-bar plugin with style=dark and enforceContrast=false', () => {
  const appJsonPath = path.join(rootDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const plugins = appJson.expo.plugins;

  const navBarPlugin = plugins.find(
    (p: any) => Array.isArray(p) && p[0] === 'expo-navigation-bar'
  );

  assert.ok(navBarPlugin, 'expo-navigation-bar plugin must be configured in plugins array');
  const config = navBarPlugin[1];
  assert.strictEqual(config.style, 'dark', 'style must be dark to render dark buttons on light background');
  assert.strictEqual(config.enforceContrast, false, 'enforceContrast must be false so OS contrast enforcement does not wash out buttons');
  assert.strictEqual(config.hidden, false, 'hidden must be false so navigation bar remains visible and accessible');
});

// 3. Check app/_layout.tsx runtime configuration
test('app/_layout.tsx mounts NavigationBar declaratively and applies style on startup', () => {
  const layoutPath = path.join(rootDir, 'app', '_layout.tsx');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');

  assert.ok(
    layoutContent.includes("import { NavigationBar } from 'expo-navigation-bar';"),
    'app/_layout.tsx must import NavigationBar from expo-navigation-bar'
  );
  assert.ok(
    layoutContent.includes("<NavigationBar style=\"dark\" />"),
    'app/_layout.tsx must render <NavigationBar style="dark" /> for Android'
  );
  assert.ok(
    layoutContent.includes("NavigationBar.setStyle('dark')"),
    'app/_layout.tsx must call NavigationBar.setStyle on Android startup'
  );
});

// 4. Check bottom tab bar safe area insets
test('app/(tabs)/_layout.tsx uses insets.bottom to position tab bar above system navigation area', () => {
  const tabLayoutPath = path.join(rootDir, 'app', '(tabs)', '_layout.tsx');
  const tabLayoutContent = fs.readFileSync(tabLayoutPath, 'utf8');

  assert.ok(
    tabLayoutContent.includes('useSafeAreaInsets'),
    'Tab layout must use useSafeAreaInsets'
  );
  assert.ok(
    tabLayoutContent.includes('insets.bottom'),
    'Tab bar height and paddingBottom must incorporate insets.bottom'
  );
  assert.ok(
    tabLayoutContent.includes('paddingBottom: Math.max(insets.bottom, 8)'),
    'Tab bar must pad bottom content safely above navigation controls'
  );
});

// 5. Check Serene light surface color preservation
test('app theme maintains Serene light background without darkening app UI', () => {
  const appJsonPath = path.join(rootDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  assert.strictEqual(appJson.expo.backgroundColor, '#FCF9F1', 'Keepr Serene background color is #FCF9F1');
  assert.strictEqual(appJson.expo.userInterfaceStyle, 'light', 'User interface style is light');
});

// 6. Check native styles.xml if android folder exists
test('android/app/src/main/res/values/styles.xml contains windowLightNavigationBar=true', () => {
  const stylesPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (fs.existsSync(stylesPath)) {
    const content = fs.readFileSync(stylesPath, 'utf8');
    assert.ok(
      content.includes('<item name="android:windowLightNavigationBar">true</item>'),
      'styles.xml must set windowLightNavigationBar to true'
    );
    assert.ok(
      content.includes('android:enforceNavigationBarContrast'),
      'styles.xml must configure enforceNavigationBarContrast'
    );
  }
});

console.log('\n================================================================');
console.log(` RESULT: ${passedTests}/${totalTests} Android navigation bar tests passed!`);
console.log('================================================================\n');
