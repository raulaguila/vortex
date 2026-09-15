// Deliberately match whole social messages. A greeting followed by a task must
// remain a normal request, and short continuations such as "continue" are not greetings.
export function isSocialMessage(message: string): boolean {
  const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  if(!normalized) return false;
  return /^(?:(?:oi+|ola|hey|hi|hello|hola|bom dia|boa tarde|boa noite|good morning|good afternoon|good evening|obrigad[oa]|muito obrigad[oa]|valeu|thanks|thank you|gracias|tudo bem|tudo bom|como vai|how are you|como estas)(?: vortex)?\s*)+$/.test(normalized);
}
