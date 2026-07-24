const fs = require('fs');
const path = require('path');

const cacheDir = path.join(__dirname, 'rivercam', 'cache');
const invalidFiles = [];

try {
    const files = fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'));

    files.forEach(file => {
        const filePath = path.join(cacheDir, file);
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            JSON.parse(content);
        } catch (error) {
            invalidFiles.push(file);
        }
    });

    console.log(`Found ${invalidFiles.length} invalid JSON files out of ${files.length} total files.`);

    if (invalidFiles.length > 0) {
        fs.writeFileSync('invalid_files.txt', invalidFiles.join('\n'));
        console.log('Invalid files list saved to invalid_files.txt');
    }

} catch (error) {
    console.error('Error:', error.message);
}