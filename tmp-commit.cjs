const { execSync } = require('child_process');
const o = { cwd: 'D:\\repos\\karmaniverous\\jeeves-scripts-template', encoding: 'utf8' };
execSync('git add -A', o);
console.log(execSync('git diff --cached --stat', o));
console.log(execSync('git commit -m "fix: move PIPELINE_CONFIG_PATH to scripts dir (was incorrectly in jeeves-core config)"', o));
console.log(execSync('git push', o));
