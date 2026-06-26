import { BRIDGE_NAMESPACE, BRIDGE_PROTOCOL_VERSION } from "./protocol.js";

// The bridge script the server inlines into every content document (both Page
// kinds) before serving it into the sandboxed iframe. It runs in the opaque
// content origin, so it cannot import modules — it is emitted as a self-
// contained string and must stay free of any `</script>` sequence.
//
// M4 responsibilities:
//  - announce `ready` to the parent (handshake),
//  - apply `set-theme` from the parent (falling back to the OS preference until
//    the first parent theme arrives — the iframe is opaque and gets no CSS var
//    inheritance from the chrome),
//  - report content height (`resize`) so the chrome can size the frame.
// Selection capture / anchor resolution are added here in M5.
export function iframeBridgeScript(): string {
  const ns = JSON.stringify(BRIDGE_NAMESPACE);
  const v = String(BRIDGE_PROTOCOL_VERSION);
  return `(function(){try{
var NS=${ns},V=${v},root=document.documentElement;
function send(msg){try{parent.postMessage({ns:NS,v:V,msg:msg},"*");}catch(e){}}
var mq=matchMedia("(prefers-color-scheme: dark)"),parentControlled=false;
function applyOs(){if(!parentControlled)root.classList.toggle("dark",mq.matches);}
applyOs();mq.addEventListener("change",applyOs);
window.addEventListener("message",function(e){
var d=e.data;if(!d||d.ns!==NS||d.v!==V||!d.msg)return;var m=d.msg;
if(m.type==="set-theme"){parentControlled=true;root.classList.toggle("dark",m.theme==="dark");}
});
var lastH=0;function reportHeight(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==lastH){lastH=h;send({type:"resize",height:h});}}
if(typeof ResizeObserver!=="undefined"){new ResizeObserver(reportHeight).observe(document.documentElement);}
window.addEventListener("load",reportHeight);
send({type:"ready"});reportHeight();
}catch(e){}})();`;
}
