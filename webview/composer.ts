/** Presentation and responsive layout of the chat composer; no agent policy lives here. */
export function localizedAttribute(element: HTMLElement, name: string, value: string) {
  // shared.ts caches attribute sources for language changes. Replace the source too.
  element.dataset['original' + name.replace(/-/g, '')] = value;
  element.setAttribute(name, window.VortexUI.t(value));
}

export function setupComposer(attach: () => void, remove: (id: string) => void) {
  const composer = document.querySelector<HTMLElement>('.composer');
  const toolbar = document.querySelector<HTMLElement>('.composer-toolbar');
  const prompt = document.querySelector<HTMLTextAreaElement>('#prompt');
  const hint = document.getElementById('draft-hint');
  const add = document.getElementById('attach-context');
  const context = document.getElementById('attached-context');
  let items: {id: string; label: string}[] = [];
  let expanded = false;
  let active = false;
  let language = window.VortexUI.language();
  let frame = 0;

  function layout() {
    frame = 0;
    // Icon controls have fixed widths; let the model truncate before wrapping.
    composer.classList.toggle('compact-controls', toolbar.clientWidth < 196);
  }
  function scheduleLayout() {
    if (!frame) frame = requestAnimationFrame(layout);
  }
  new ResizeObserver(scheduleLayout).observe(toolbar);
  new MutationObserver(scheduleLayout).observe(toolbar, {subtree: true, childList: true, characterData: true});
  document.fonts.ready.then(scheduleLayout);

  function renderAttachments(focusId?: string) {
    context.replaceChildren();
    context.hidden = !items.length;
    const visible = expanded ? items : items.slice(0, 2);
    for (const item of visible) {
      const chip = document.createElement('span');
      chip.className = 'context-chip';
      const label = document.createElement('span');
      label.className = 'context-chip-label';
      label.textContent = item.label;
      label.title = item.label;
      const button = document.createElement('button');
      button.className = 'context-remove';
      button.type = 'button';
      button.textContent = '×';
      const description = window.VortexUI.t('Remove context') + ': ' + item.label;
      button.setAttribute('aria-label', description);
      button.title = description;
      button.dataset.attachmentId = item.id;
      button.onclick = () => remove(item.id);
      chip.append(label, button);
      context.append(chip);
    }
    if (items.length > 2) {
      const more = document.createElement('button');
      more.className = 'context-more';
      more.type = 'button';
      more.textContent = expanded ? window.VortexUI.t('Show less') : '+' + (items.length - 2);
      more.setAttribute('aria-expanded', String(expanded));
      more.setAttribute('aria-label', window.VortexUI.t(expanded ? 'Show less context' : 'Show all context'));
      more.onclick = () => { expanded = !expanded; renderAttachments('more'); };
      context.append(more);
    }
    if (focusId === 'more') context.querySelector<HTMLButtonElement>('.context-more')?.focus();
    else if (focusId) {
      const next = [...context.querySelectorAll<HTMLButtonElement>('.context-remove')].find(b => b.dataset.attachmentId === focusId);
      (next || context.querySelector<HTMLButtonElement>('button') || add).focus();
    }
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'composer-tooltip';tooltip.id = 'composer-tooltip';tooltip.role = 'tooltip';tooltip.hidden = true;
  document.body.append(tooltip);
  let tooltipOwner: HTMLElement | null = null;
  function hideTooltip() { tooltip.hidden = true;tooltipOwner?.removeAttribute('aria-describedby');tooltipOwner = null; }
  for (const id of ['mode-trigger', 'permission-trigger']) {
    const trigger = document.getElementById(id)!;
    const show = () => {
      if (trigger.getAttribute('aria-expanded') === 'true') return;
      tooltipOwner = trigger;tooltip.textContent = trigger.dataset.tooltip || trigger.getAttribute('aria-label');
      tooltip.hidden = false;trigger.setAttribute('aria-describedby', tooltip.id);
      const rect = trigger.getBoundingClientRect();
      tooltip.style.left = Math.max(8, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 8)) + 'px';
      tooltip.style.top = Math.max(8, rect.top - tooltip.offsetHeight - 8) + 'px';
    };
    trigger.addEventListener('pointerenter', show);trigger.addEventListener('focus', show);
    trigger.addEventListener('pointerleave', hideTooltip);trigger.addEventListener('blur', hideTooltip);
    trigger.addEventListener('click', hideTooltip);
  }
  document.addEventListener('vortex:overlay-open', hideTooltip);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
  window.addEventListener('resize', hideTooltip);
  add.onclick = attach;
  prompt.addEventListener('input', (event: InputEvent) => {
    hint.hidden = !(active && prompt.value.trim());
    // Only a typed mention token opens the picker; emails, pasted text and IME do not.
    const before = prompt.value.slice(0, prompt.selectionStart);
    if (!event.isComposing && event.inputType === 'insertText' && event.data === '@' && /(?:^|\s)@$/.test(before)) attach();
  });
  scheduleLayout();
  return {
    refresh(mode: string, running: boolean, readOnly: boolean) {
      active = running;
      localizedAttribute(prompt, 'placeholder', {
        ask: 'Ask about the project…', plan: 'What would you like to plan?', agent: 'Describe what you want to implement…'
      }[mode] || 'Ask about the project…');
      const message = window.VortexUI.t('Draft to send after completion');
      if (hint.textContent !== message) hint.textContent = message;
      if (language !== window.VortexUI.language()) {
        language = window.VortexUI.language();
        renderAttachments();
      }
      hint.hidden = !(running && prompt.value.trim());
      add.toggleAttribute('disabled', readOnly);
      localizedAttribute(add, 'title', 'Add context');
      localizedAttribute(add, 'aria-label', 'Add context');
      scheduleLayout();
    },
    attachments(next: {id: string; label: string}[]) {
      const focused = document.activeElement as HTMLElement;
      const focusId = context.contains(focused) ? focused.dataset.attachmentId || 'more' : undefined;
      items = next;
      if (items.length <= 2) expanded = false;
      renderAttachments(focusId);
    }
  };
}
