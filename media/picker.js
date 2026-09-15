// Shared popover behavior for model, mode and permission selectors.
(() => {
  let active;
  class ComposerPicker {
    constructor(panel, anchor) {
      this.panel=panel;this.anchor=anchor;
      panel.classList.add('composer-picker');
      new ResizeObserver(()=>this.position()).observe(anchor);
      panel.addEventListener('keydown',event=>{
        const controls=[...panel.querySelectorAll('input:not(:disabled),button:not(:disabled)')].filter(el=>el.getClientRects().length);
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}
        if(!['ArrowDown','ArrowUp','Tab','Home','End'].includes(event.key)||!controls.length)return;
        if(['Home','End'].includes(event.key)&&event.target.tagName==='INPUT')return;
        event.preventDefault();const index=controls.indexOf(document.activeElement);
        const next=event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowUp'||event.shiftKey?controls.length-1:1))%controls.length;
        controls[next].focus();
      });
    }
    open(trigger,initial) {
      if(active)active.close(false);
      active=this;this.trigger=trigger;this.panel.hidden=false;trigger.setAttribute('aria-expanded','true');
      this.position();(initial||this.panel.querySelector('[aria-checked="true"],input,button'))?.focus();
    }
    position(){
      if(this.panel.hidden)return;
      const rect=this.anchor.getBoundingClientRect();
      Object.assign(this.panel.style,{left:rect.left+'px',right:'auto',width:rect.width+'px',bottom:Math.max(4,innerHeight-rect.top+6)+'px',maxHeight:Math.max(0,rect.top-12)+'px'});
    }
    close(focus=true){this.panel.hidden=true;this.trigger?.setAttribute('aria-expanded','false');if(active===this)active=undefined;if(focus)this.trigger?.focus();}
  }
  document.addEventListener('pointerdown',event=>{if(active&&!active.panel.contains(event.target)&&!active.trigger?.contains(event.target))active.close(false);});
  window.addEventListener('resize',()=>active?.position());
  new ResizeObserver(()=>active?.position()).observe(document.body);
  window.ComposerPicker=ComposerPicker;
})();
