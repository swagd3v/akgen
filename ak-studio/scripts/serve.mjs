import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));const port=Number(process.env.PORT||4318);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.txt':'text/plain'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}if(!(await stat(file)).isFile())throw Error('Not a file');res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(await readFile(file));}catch{res.writeHead(404,{'content-type':'text/plain'}).end('File not found');}});
server.listen(port,'127.0.0.1',()=>{
 const url=`http://127.0.0.1:${port}`;
 console.log(`AK Studio: ${url}`);
 if(process.argv.includes('--open')&&!process.argv.includes('--no-open')&&process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true},error=>{if(error)console.log('Open the URL above in your browser.');});
});server.on('error',e=>{console.error(e.message);process.exit(1);});

