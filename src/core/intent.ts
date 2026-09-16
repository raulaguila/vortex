// Deliberately match whole social messages. A greeting followed by a task must
// remain a normal request, and short continuations such as "continue" are not greetings.
export function isSocialMessage(message: string): boolean {
  const normalized=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  if(!normalized) return false;
  return /^(?:(?:oi+|ola|hey|hi|hello|hola|bom dia|boa tarde|boa noite|good morning|good afternoon|good evening|obrigad[oa]|muito obrigad[oa]|valeu|thanks|thank you|gracias|tudo bem|tudo bom|como vai|how are you|como estas)(?: vortex)?\s*)+$/.test(normalized);
}

// A narrow completion guard for explicit planning requests, not a complexity
// classifier. Other development requests follow the mode prompt; an actual
// propose_plan attempt also activates the runtime guard regardless of wording.
export function isExplicitPlanningRequest(message:string):boolean {
 const text=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 return /^(?:(?:por favor|please)[,\s]+)?(?:planeje\b|plan(?:\s+(?!mode\b)|$)|(?:crie|monte|elabore|faca|gere|create|make|generate|propose|revise|update|atualize)\s+(?:(?:um|o|a|the|an?)\s+)?(?:plano|plan)\b)/.test(text);
}

// Conservative guard for a short, standalone promise of action. This is not an
// intent classifier and never grants authorization or translates prose into tools.
export function isActionAnnouncement(message:string,request=''):boolean {
 if(/^(?:traduza|translate|traduce|reescreva|rephrase|rewrite)\b/i.test(request.trim()))return false;
 const text=message.trim();
 if(!text||text.length>400||/[\n?`]/.test(text)||/^["'“”‘’>]/.test(text))return false;
 const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/’/g,"'").toLowerCase();
 if(/\b(?:mas|porem|nao|preciso que|se voce|but|cannot|can't|if you|please|pero|no puedo)\b/.test(normalized))return false;
 if(/[.!]\s+\S/.test(normalized))return false;
 return /^(?:(?:vou|irei)\s+(?:(?:primeiro|agora)\s+)?(?:explorar|examinar|analisar|inspecionar|ler|listar|verificar|pesquisar|buscar|editar|alterar|implementar|executar|corrigir)|(?:i will|i'll|let me|i am going to|i'm going to)\s+(?:(?:first|now)\s+)?(?:explore|examine|analyze|inspect|read|list|check|search|edit|implement|run|fix)|voy a\s+(?:explorar|examinar|analizar|inspeccionar|leer|listar|verificar|buscar|editar|implementar|ejecutar|corregir))\b/.test(normalized);
}
