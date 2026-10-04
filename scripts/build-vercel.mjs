#!/usr/bin/env node
// Publish only the browser application. Durable APIs stay on the existing VPS.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'public');
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
for(const item of ['assets','games','index.html','parent.html','manifest.webmanifest','sw.js']){
 fs.cpSync(path.join(root,item),path.join(output,item),{recursive:true});
}
console.log('Built Vercel static site in public/; no runtime data, secrets, or server code included.');
