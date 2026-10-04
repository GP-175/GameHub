const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('Vercel publishes browser assets without runtime data or serverless storage',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 assert.equal(config.framework,null);
 assert.equal(config.outputDirectory,'public');
 assert.equal(config.buildCommand,'npm run build:vercel');
 assert.equal(config.rewrites.find(r=>r.source==='/api/:path*').destination,'https://gp-hoot.gplange.tech/api/:path*');
 assert.equal(config.redirects.find(r=>r.source==='/gp-hoot').destination,'https://gp-hoot.gplange.tech/gp-hoot');
 assert.ok(config.headers.find(h=>h.source==='/sw.js').headers[0].value.includes('no-store'));
 execFileSync(process.execPath,['scripts/build-vercel.mjs'],{cwd:root});
 for(const p of ['index.html','parent.html','sw.js','manifest.webmanifest','games/type-safari.html','assets/type-safari/app.js','assets/type-safari/hub-adapter.js','assets/type-safari/hand-position.png']){
  assert.deepEqual(fs.readFileSync(path.join(root,'public',p)),fs.readFileSync(path.join(root,p)));
 }
 for(const p of ['.data','data','uploads','server','node_modules','.env','.git','.vercel'])assert.equal(fs.existsSync(path.join(root,'public',p)),false,p);
});
