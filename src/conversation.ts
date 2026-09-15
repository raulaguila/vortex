import {ConversationPreferences} from './protocol';
export function languageInstruction(language: ConversationPreferences['language']): string {
  return {pt: 'Answer in Portuguese.', en: 'Answer in English.', es: 'Answer in Spanish.', auto: "Answer in the language of the user's message."}[language];
}
