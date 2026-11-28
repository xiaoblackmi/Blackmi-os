const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');

const template = path.join(__dirname, '../client/Blackmi_OS_V3.2.2_DeveloperSDK.html');
const marker = '<!-- BLACKMI_SDK_BUNDLES -->';

function bundle(output, inputs) {
  const html = fs.readFileSync(template, 'utf8');
  if (html.indexOf(marker) < 0 || html.indexOf(marker) !== html.lastIndexOf(marker)) {
    throw new Error('Expected one SDK bundle marker');
  }

  const scripts = inputs.map(input => {
    const code = fs.readFileSync(input, 'utf8');
    if (/<\/?script|<!--/i.test(code)) {
      throw new Error(input + ' contains an HTML script tag or comment opener');
    }
    new Script(code, { filename: input });
    return '<script>\n' + code + '\n</script>';
  });

  fs.writeFileSync(output, html.replace(marker, () => scripts.join('\n')), { flag: 'wx' });
  return output;
}

if (require.main === module) {
  const [output, ...inputs] = process.argv.slice(2);
  try {
    if (!output || !inputs.length) {
      throw new Error('Usage: node sdk/bundle.cjs OUTPUT.html MODULE.js [MODULE.js ...]');
    }
    console.log(bundle(output, inputs));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { bundle };
