// Offline TypeScript check using installed SDK types and virtual Deno globals.
// Remote esm.sh/Deno execution itself still requires staging verification.
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve('supabase/functions');
const files = [];
function visit(dir) { for (const entry of readdirSync(dir,{withFileTypes:true})) { const file=join(dir,entry.name); if(entry.isDirectory())visit(file);else if(file.endsWith('.ts'))files.push(file); } }
visit(root);
const globals=resolve('scripts/.edge-runtime.virtual.d.ts');
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions:true,noEmit:true,strict:true,skipLibCheck:true,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']};
const host=ts.createCompilerHost(options), originalRead=host.readFile.bind(host), originalExists=host.fileExists.bind(host);
host.fileExists=file=>resolve(file)===globals||originalExists(file);
host.readFile=file=>resolve(file)===globals?"declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void };":originalRead(file)?.replace("'https://esm.sh/@supabase/supabase-js@2.45.0'","'@supabase/supabase-js'");
const program=ts.createProgram([...files,globals],options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));process.exitCode=1;}
else console.log(`PASS offline Edge TypeScript: ${files.length} files; no network or filesystem output.`);
