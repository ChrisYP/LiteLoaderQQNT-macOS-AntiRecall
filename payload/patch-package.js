ObjC.import('Foundation');

function readUtf8(filePath) {
    const value = $.NSString.stringWithContentsOfFileEncodingError(
        filePath,
        $.NSUTF8StringEncoding,
        null
    );
    if (!value) {
        throw new Error(`Unable to read JSON file: ${filePath}`);
    }
    return ObjC.unwrap(value);
}

function writeUtf8(filePath, content) {
    const value = $(content);
    const succeeded = value.writeToFileAtomicallyEncodingError(
        filePath,
        true,
        $.NSUTF8StringEncoding,
        null
    );
    if (!succeeded) {
        throw new Error(`Unable to write JSON file: ${filePath}`);
    }
}

function run(arguments_) {
    if (arguments_.length !== 2) {
        throw new Error('Usage: patch-package.js INPUT_JSON OUTPUT_JSON');
    }

    const inputPath = arguments_[0];
    const outputPath = arguments_[1];
    const packageJson = JSON.parse(readUtf8(inputPath));
    packageJson.main = './app_launcher/ml_install.js';
    writeUtf8(outputPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
