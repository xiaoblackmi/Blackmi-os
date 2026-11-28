const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { bundle } = require('../../sdk/bundle.cjs');

const modules = ['cards.js', 'heroes.js', 'rules.js', 'ui.js', 'register.js'].map(file => path.join(__dirname,file));
const release = path.join(__dirname,'../../client/Blackmi_OS_V3.3_ThreeKingdoms_RC2.html');

function build(output = release) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'blackmi-three-kingdoms-'));
  try {
    const bundled = bundle(path.join(scratch,'candidate.html'),modules);
    let html = fs.readFileSync(bundled,'utf8');
    const branding = [
      ['name="blackmi-version" content="3.2.2"', 'name="blackmi-version" content="3.3"'],
      ["APP_EDITION='Developer SDK'", "APP_EDITION='Three Kingdoms RC2'"]
    ];
    for (const [before, after] of branding) {
      if (html.split(before).length !== 2) throw Error('SDK template branding marker changed');
      html = html.replace(before,after);
    }
    fs.writeFileSync(output,html,{flag:'wx'});
    return output;
  } finally {
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}

if (require.main === module) {
  try { console.log(build(process.argv[2])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {build,modules,release};
