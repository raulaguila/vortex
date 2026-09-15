import type {Request} from '../src/protocol';
declare global {
 function acquireVsCodeApi():{getState():any;setState(value:unknown):void;postMessage(message:Request):void};
 interface Window {ComposerPicker:any;VortexUI:any;VortexPicker:any;VortexMarkdown:any;VortexIcons:any;}
}
export {};
