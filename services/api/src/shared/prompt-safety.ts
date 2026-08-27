/**
 * Helpers for safely embedding untrusted user text (reflections, comments, etc.)
 * inside a Bedrock prompt that also carries trusted instructions.
 *
 * We delimit untrusted text with an XML-style tag (e.g. <student_reflection>)
 * and tell the model to treat its contents as plain text, never instructions.
 * That mitigation only holds if the untrusted text itself cannot contain a
 * literal closing tag — otherwise it can "break out" of the wrapper and the
 * text that follows is read as trusted. `escapeForPromptTag` neutralizes
 * that by escaping every '<' and '>' in the untrusted text before wrapping.
 */

export function escapeForPromptTag(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Wraps untrusted text in a named XML-style tag, escaping angle brackets first
 *  so the text cannot close the tag early and inject trusted-looking content. */
export function wrapUntrustedText(tag: string, text: string): string {
  const safe = escapeForPromptTag(text);
  return `<${tag}>\n${safe}\n</${tag}>`;
}
