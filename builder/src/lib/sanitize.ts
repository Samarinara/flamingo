/** Input cleaners: rewrite what the user types into an allowed form. */
export const sanitize = {
  id: (v: string) => v.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
  bin: (v: string) => v.replace(/[^01]/g, ""),
}
