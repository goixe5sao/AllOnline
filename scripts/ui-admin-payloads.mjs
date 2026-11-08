import ts from 'typescript';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const evidence=[];
const baseline=execFileSync('git',['log','-1','--format=%H','--grep=redesign orders and payment presentation'],{encoding:'utf8'}).trim();
assert.ok(baseline);
for(const file of ['src/app/admin/page.tsx','src/app/admin/proofs-tab.tsx']){
const before=execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'}),after=readFileSync(file,'utf8');
const collect=input=>{const text=input.replace(/\r\n/g,"\n");const root=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),items=[];const walk=n=>{if(ts.isCallExpression(n)&&n.expression.getText(root)==='api')items.push(n.getText(root));if(ts.isJsxAttribute(n)&&['onClick','onChange','onBlur','onSubmit'].includes(n.name.getText(root)))items.push(n.getText(root));ts.forEachChild(n,walk);};walk(root);return items;};
assert.deepEqual(collect(after),collect(before),file+' handlers and API calls changed');
// Include settings serialization and save functions before the rendered form.
if(file.endsWith('/page.tsx')){const prefix=t=>t.slice(t.indexOf('function SettingsForm('),t.indexOf('  return (',t.indexOf('function SettingsForm(')));assert.equal(prefix(after).replace(/\r\n/g,"\n"),prefix(before).replace(/\r\n/g,"\n"));}
evidence.push({file,unchangedHandlersAndApiCalls:collect(after).length,settingsSerializationUnchanged:true});
}
writeFileSync('docs/screenshots/ui/after/t6-payload-report.json',JSON.stringify(evidence,null,2));console.log('PASS all admin handlers, API calls and settings serialization exactly match pre-T6 source');

