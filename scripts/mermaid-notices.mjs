import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
const exists=async file=>{try{await access(file);return true}catch{return false}};

export async function writeMermaidNotices(inputs){
 const packages=new Map(),embedded=new Set();
 async function collect(file){
  let directory=dirname(resolve(file));
  while(directory!==dirname(directory)){
   try{const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(pkg.name&&pkg.version){packages.set(pkg.name+' '+pkg.version,{directory,pkg});return}}catch{}
   directory=dirname(directory);
  }
  throw Error('Missing package metadata for '+file);
 }
 for(const input of inputs){
  if(!input.includes('node_modules/'))continue;
  await collect(input);
  // Mermaid publishes js-yaml and fastdom already bundled. Its source maps identify those inputs.
  for(const match of (await readFile(input,'utf8')).matchAll(/node_modules\/\.pnpm\/([^/]+?)@([0-9][^/_]*)[^/]*\/node_modules\//g)){
   const name=match[1].replace('+','/');if(!packages.has(name+' '+match[2])&&!await exists('node_modules/'+name+'/package.json'))embedded.add(name);
  }
  try{
   const map=JSON.parse(await readFile(input+'.map','utf8'));
   for(const source of map.sources||[]){
    if(!source.includes('node_modules/'))continue;
    const tail=source.split('node_modules/').at(-1),name=tail.startsWith('@')?tail.split('/').slice(0,2).join('/'):tail.split('/')[0];
    try{await readFile('node_modules/'+name+'/package.json');await collect('node_modules/'+name+'/package.json')}catch(error){if(error.code!=='ENOENT')throw error;embedded.add(name)}
   }
  }catch(error){if(error.code!=='ENOENT')throw error}
 }
 let text='';
 for(const [name,{directory,pkg}] of [...packages].sort(([a],[b])=>a.localeCompare(b,'en'))){
  const files=(await readdir(directory)).filter(file=>/^(?:licen[sc]e|copying|notice)(?:\.|$)/i.test(file)).sort();
  if(!files.length)throw Error('Missing licence for '+name+' ('+pkg.license+')');
  text+='\n\n'+name+'\n'+(await Promise.all(files.map(file=>readFile(join(directory,file),'utf8')))).join('\n');
 }
 // These packages ship inside upstream bundles, rather than as separate npm directories.
 // Versions are preserved in their pnpm source paths; MIT attribution is preserved in source-map headers.
 const embeddedMIT={
  'js-yaml':['4.3.0','Copyright (C) 2011-2015 by Vitaly Puzrin'],
  fastdom:['1.0.12','Copyright (c) 2015 Wilson Page'],
  'vscode-jsonrpc':['9.0.3','Copyright (c) Microsoft Corporation. All rights reserved.'],
  'vscode-languageserver-types':['3.18.4','Copyright (c) Microsoft Corporation. All rights reserved.'],
  'vscode-languageserver-protocol':['3.18.4','Copyright (c) Microsoft Corporation. All rights reserved.'],
  'vscode-languageserver-textdocument':['1.0.15','Copyright (c) Microsoft Corporation. All rights reserved.'],
  'vscode-uri':['3.1.0','Copyright (c) Microsoft Corporation. All rights reserved.'],
  langium:['4.4.0','Copyright 2021 TypeFox GmbH'],
  'chevrotain-allstar':['0.5.0','Copyright 2022 TypeFox GmbH'],
  // Embedded by vscode-uri; its source header identifies the Node.js v8.11.1 implementation.
  'path-browserify':['1.0.1','Copyright (c) 2013 James Halliday\nCopyright Joyent, Inc. and other Node contributors.'],
 };
 const mermaidLicence=await readFile('node_modules/mermaid/LICENSE','utf8'),mit=mermaidLicence.slice(mermaidLicence.indexOf('Permission is hereby granted'));
 for(const name of [...embedded].sort()){
  if(!embeddedMIT[name])throw Error('Missing embedded licence for '+name);
  const [version,copyright]=embeddedMIT[name];text+='\n\n'+name+' '+version+'\nMIT License\n\n'+copyright+'\n\n'+mit;
 }
 const file='web/THIRD_PARTY_NOTICES.txt',marker='\n\nMermaid lazy chunk dependencies (generated from bundled inputs)\n';
 const existing=(await readFile(file,'utf8')).split(marker)[0].trimEnd();
 // Packages already licensed above are listed once, including shared DOMPurify versions.
 const sections=text.split(/\n\n(?=(?:@[^\s]+|[\w.-]+) [0-9][^\n]*\n)/).filter(Boolean).filter(section=>!existing.split('\n').includes(section.split('\n')[0]));
 await writeFile(file,existing+marker+sections.join('\n\n').trimEnd()+'\n');
 console.log('Mermaid licence inventory: '+packages.size+' packages plus '+embedded.size+' embedded packages');
}
