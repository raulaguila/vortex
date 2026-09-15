const {spawn}=require('node:child_process');
const esbuild=require('esbuild');
(async()=>{
 const compiler=spawn(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','.','--watch','--noEmit'],{stdio:'inherit'});
 const webCompiler=spawn(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.webview.json','--watch'],{stdio:'inherit'});
 const contexts=await Promise.all([
  esbuild.context({entryPoints:['webview/app.ts','webview/settings.ts','webview/shared.ts','webview/picker.ts'],bundle:true,platform:'browser',format:'iife',outdir:'media'}),
  esbuild.context({entryPoints:['media/vendor-entry.js'],bundle:true,platform:'browser',format:'iife',minify:true,outfile:'media/vendor.js'}),
  esbuild.context({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],target:'node20',outfile:'dist/extension.js'})
 ]);
 await Promise.all(contexts.map(c=>c.watch()));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{compiler.kill();webCompiler.kill();await Promise.all(contexts.map(c=>c.dispose()));process.exit();});
})().catch(error=>{console.error(error);process.exitCode=1;});
