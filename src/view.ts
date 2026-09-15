const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function renderSidebar(template: string, options: {cspSource: string; nonce: string; style: string; script: string; logo: string; shared?: string; vendor?: string; picker?: string; version?: string}): string {
  return template.replace(/\{\{(cspSource|nonce|style|script|logo|shared|vendor|picker|version)\}\}/g, (_, key: keyof typeof options) => escapeAttribute(options[key] || ''));
}
