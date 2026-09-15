const MarkdownIt = require('markdown-it');
const DOMPurify = require('dompurify');
const md = new MarkdownIt({html:false,linkify:true,breaks:true});
window.VortexMarkdown = {render: text => DOMPurify.sanitize(md.render(text), {FORBID_TAGS:['img','style','script','iframe','form','input'],FORBID_ATTR:['style','id'],ALLOW_DATA_ATTR:false})};
