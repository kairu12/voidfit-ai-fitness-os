import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = __dirname;
const envExamplePath = path.join(projectRoot, '.env.example');
const envPath = path.join(projectRoot, '.env');

console.log('=========================================================================');
console.log('🌌 VOIDFIT AI - FITNESS OS: INITIAL SETUP PROTOCOL');
console.log('=========================================================================');

// 1. Check Node.js version
console.log('\n🔍 STEP 1: Verifying System Requirements...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);

if (majorVersion < 18) {
  console.error(`❌ Node.js version ${nodeVersion} detected. Node.js 18+ is required.`);
  process.exit(1);
}
console.log(`✅ System matches requirements: Node.js ${nodeVersion} detected.`);

// 2. Setup Environment File
console.log('\n🔑 STEP 2: Configuring Environment variables...');
if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    try {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created `.env` configuration file from `.env.example`.');
      console.log('👉 Please configure your specific keys (Google OAuth & Firebase) in the newly created `.env` file.');
    } catch (err) {
      console.error('❌ Failed to copy `.env.example` to `.env`:', err.message);
    }
  } else {
    console.warn('⚠️ `.env.example` template not found. Skipping config copy.');
  }
} else {
  console.log('✅ Existing `.env` configuration file detected.');
}

// 3. Install NPM Dependencies
console.log('\n📦 STEP 3: Installing Node packages (npm install)...');
try {
  console.log('⏳ Running npm install, please wait...');
  execSync('npm install', { stdio: 'inherit', cwd: projectRoot });
  console.log('✅ Successfully installed dependencies.');
} catch (err) {
  console.error('❌ Dependencies installation failed:', err.message);
  process.exit(1);
}

// 4. Run Verification Tests
console.log('\n🧪 STEP 4: Running System Verification Tests (npm run test)...');
try {
  console.log('⏳ Executing test suites...');
  execSync('npm run test', { stdio: 'inherit', cwd: projectRoot });
  console.log('✅ All test suites passed successfully.');
} catch (err) {
  console.warn('⚠️ Some tests failed or vitest was not fully ready. Don\'t worry, check your configuration fields.');
}

console.log('\n=========================================================================');
console.log('🎉 SETUP PROTOCOL COMPLETE');
console.log('=========================================================================');
console.log('To start VoidFit AI Fitness OS locally:');
console.log('  1. Open `.env` and fill in your Gemini, Google, or Firebase settings.');
console.log('  2. Run the developer server:');
console.log('       npm run dev');
console.log('  3. Open your browser and navigate to:');
console.log('       http://localhost:3000');
console.log('=========================================================================');
