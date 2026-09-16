const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
// Keep SVGs inline for a restrictive webview CSP. No icon font or framework at runtime.
const icons={plus:'plus',settings:'settings',back:'arrow-left',chevron:'chevron-down',arrow:'arrow-up',stop:'square',shield:'shield-check',bolt:'zap',eye:'eye',close:'x',copy:'copy',edit:'pencil',search:'search',model:'bot','new-chat':'square-pen',hand:'hand',ask:'message-circle',plan:'list-checks',agent:'code',refresh:'refresh-cw',star:'star',trash:'trash-2'};
const file=path.join(root,'media/sidebar.html');let html=fs.readFileSync(file,'utf8');
for(const [id,name]of Object.entries(icons)){
 const svg=fs.readFileSync(path.join(root,'node_modules/lucide-static/icons',name+'.svg'),'utf8');
 const body=svg.slice(svg.indexOf('>',svg.indexOf('<svg'))+1,svg.lastIndexOf('</svg>')).trim();
 html=html.replace(new RegExp('<symbol id="i-'+id+'"[^>]*>[\\s\\S]*?</symbol>'),()=>'<symbol id="i-'+id+'" viewBox="0 0 24 24">'+body+'</symbol>');
}
fs.writeFileSync(file,html);
