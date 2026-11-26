/**
 * An environment variable, or undefined when it's empty or a placeholder like "N/A",
 * so settings can be created in Vercel before they're filled in.
 */
export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || /^(n\/?a|none|null|tbd|-)$/i.test(value)) return undefined;
  return value;
}
