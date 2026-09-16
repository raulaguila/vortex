import {ConversationPreferences} from "./protocol";
export function languageInstruction(language: ConversationPreferences['language']): string {
  const base: Record<typeof language, string> = {
    pt: 'Answer in Portuguese.',
    en: 'Answer in English.',
    es: 'Answer in Spanish.',
    auto: "Answer in the language of the user's message.",
  };
  return base[language];
}
