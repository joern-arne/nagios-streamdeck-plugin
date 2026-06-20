const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const manifestPath = path.join(__dirname, '../com.joern-arne.nagios.sdPlugin/manifest.json');

console.log('🚀 Starting release process...');

// 1. Check git status to ensure working directory is clean
try {
    const status = execSync('git status --porcelain').toString().trim();
    if (status) {
        console.error('❌ Git working directory is not clean. Please commit or stash your changes first.');
        process.exit(1);
    }
} catch (e) {
    console.error('❌ Failed to verify Git status:', e.message);
    process.exit(1);
}

// 2. Read current manifest version
let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
    console.error('❌ Failed to read manifest.json:', e.message);
    process.exit(1);
}

const currentVersion = manifest.Version || '0.0.0.0';
console.log(`Current version in manifest: ${currentVersion}`);

// 3. Prompt for the new version number
rl.question('Enter new version (X.Y.Z.W format, e.g. 0.1.1.0): ', (newVersion) => {
    rl.close();
    
    // Validate version format (4-part version number mandated by Stream Deck)
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(newVersion)) {
        console.error('❌ Invalid version format. Must be X.Y.Z.W (4 decimal parts, e.g., 0.1.1.0).');
        process.exit(1);
    }
    
    if (newVersion === currentVersion) {
        console.error('❌ New version cannot be the same as the current version.');
        process.exit(1);
    }

    try {
        // 4. Update manifest.json version
        manifest.Version = newVersion;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
        console.log(`✅ Updated manifest.json to version ${newVersion}`);

        // 5. Commit version bump
        execSync(`git add "${manifestPath}"`);
        execSync(`git commit -m "Bump version to ${newVersion}"`);
        console.log(`✅ Committed version bump`);

        // 6. Tag the commit
        const tag = `v${newVersion}`;
        execSync(`git tag -a ${tag} -m "Release ${tag}"`);
        console.log(`✅ Created Git tag ${tag}`);

        // 7. Push — triggers the GitHub Actions release workflow
        console.log('📤 Pushing commit and tag to remote...');
        execSync('git push origin main --tags', { stdio: 'inherit' });
        console.log(`✅ Pushed main and ${tag} to remote`);

        console.log(`\n🎉 Tag ${tag} pushed — GitHub Actions will build, pack, and publish the release.`);
        console.log(`👉 Next step: upload 'com.joern-arne.nagios.streamDeckPlugin' to the Elgato Maker Console once the workflow completes.`);
    } catch (error) {
        console.error('❌ An error occurred during the release process:', error.message);
        process.exit(1);
    }
});
